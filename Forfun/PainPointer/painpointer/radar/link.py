"""레이더 연결층(T9): 필요·능력·한계 추출 → 토픽·사건 범주 매핑 → 필요↔능력 간선 → 왜-지금 → 빈자리(공급 검색).

모든 판정은 '임베딩 후보 → LLM 확인('AI 판정')' 두 단계다. 임베딩 임계는 후보를 거르는 초기값일 뿐이고,
판정 결과는 model·prompt_hash와 함께 저장해 프롬프트가 바뀌면 다시 판정한다. 외부 원문은 `<doc>` 틀(guard)에 넣고,
llm_calls에는 본문 대신 해시만 남는다(단계 이름이 radar_ → llm.redacts_docs). 예산은 레이더 범위.

왜-지금 판정표(D14, MAP-Elites 기술자로 쓰는 유일한 정의):

    조건                     충족(met)                                   미측정(unmeasured)
    (a) 페인 지속            리포트 등장 월 ≥ WHYNOW_MIN_MONTHS(6)         리포트 없음
    (b) 막힘 근거            이 간선에 대응하는 한계 문장 ≥ 1(AI 판정)       한계 문장이 아직 하나도 없음
    (c) 그 한계의 날짜 있는 개선:                                         (c1)(c2) 둘 다 미측정
        (c1) 그 한계에 대응하는 벤치마크 SOTA가 최근 12개월에 개선(L5)
        (c2) 최근 12개월 논문 중 그 한계를 해결했다고 주장 ≥ 2편(AI 판정)
    강도: 셋 다 충족 = strong, 둘 = mid, 하나 이하 = weak. 미측정은 불충족으로 센다(그래서 최대 mid).
          미측정이 둘 이상이면 'unmeasured'(아카이브 밖 목록).
    토픽 인기(L2 증가율)·현재 성숙도는 '관심·준비도'로 따로 돌려줄 뿐 강도에 넣지 않는다.

빈자리 고정 검색 규약(D15): 원천 5곳(SUPPLY_SOURCES) 모두 같은 질의 3종(필요·능력·결합)으로 원천별 상위 20건,
원천별 임계 이상만 '유사'로 세고, 원천 간 중복(URL·제목·임베딩 ≥ 0.9)은 1건으로. 5곳 전부 성공해야 측정 —
하나라도 실패하면 빈자리·참신성 둘 다 '미측정'(누락이 점수를 올리지 못하게).

사건 대표값(D5): LLM 확인을 통과한 매핑 중 점수 최고 범주 1개의 점유율 변화 비율. 나머지는 보조 목록.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .. import config, guard
from ..llm import LLM, LLMError, load_prompt
from ..textnorm import clip_quote, prompt_hash
from . import radar_db
from .sources import SourceError, SourceUnavailable, last_full_month, shift_month
from .sources_l2 import abstract_text, short_id

EXTRACT_KINDS = ("need", "capability", "limit")
_ITEM_MAX = {"need": 3, "capability": 2, "limit": 2}
_TEXT_MAX = 80
_CWE_PATH = Path(__file__).with_name("data") / "cwe_names.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _model() -> str:
    return config.MODEL_RADAR or config.MODEL_CLASSIFY


def _unit(M: np.ndarray) -> np.ndarray:
    M = np.asarray(M, dtype=np.float32)
    if M.ndim == 1:
        return M / (np.linalg.norm(M) or 1.0)
    return M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-9)


def _sims(q: np.ndarray, M: np.ndarray) -> np.ndarray:
    return _unit(M) @ _unit(q) if len(M) else np.zeros(0)


@dataclass
class Doc:
    """추출 입력 문서. ref = signal_items.id 또는 'report:<id>'. text는 저장하지 않는다(인용 대조·인젝션 검사용)."""
    ref: str
    text: str
    url: str | None = None
    published_at: str | None = None


# ---------------------------------------------------------------- 추출(필요·능력·한계)

def _extract_schema(kind: str) -> dict:
    item = {"type": "object", "properties": {"text": {"type": "string"}, "search_en": {"type": "string"},
                                             "quote": {"type": "string"}},
            "required": ["text", "search_en", "quote"], "additionalProperties": False}
    doc = {"type": "object", "properties": {"id": {"type": "string"}, "items": {"type": "array", "items": item},
                                            "inj": {"type": "boolean"}},
           "required": ["id", "items", "inj"], "additionalProperties": False}
    return {"type": "object", "properties": {"docs": {"type": "array", "items": doc}}, "required": ["docs"],
            "additionalProperties": False}


def _done_refs(conn, kind: str, refs: list[str], ph: str, model: str) -> set[str]:
    if not refs:
        return set()
    q = ",".join("?" * len(refs))
    return {r[0] for r in conn.execute(f"SELECT DISTINCT item_ref FROM radar_extracts WHERE kind=? AND prompt_hash=?"
                                       f" AND model=? AND item_ref IN ({q})", (kind, ph, model, *refs))}


def extract(kind: str, docs: list[Doc], llm: LLM, *, radar_path=None, model: str | None = None,
            batch: int | None = None, progress=None) -> dict:
    """문서별 필요·능력·한계 추출. 같은 (문서, 프롬프트, 모델)은 다시 부르지 않는다.

    - 인용은 원문에 글자 그대로 있을 때만 남긴다(guard.kept_quote). 플래그 문서는 인용을 버리고 injection_flag=1.
    - 추출이 0개인 문서는 text=''인 표지 행 하나를 남겨 재호출을 막는다(조회는 text != ''만 본다).
    반환 {"n_docs", "n_calls", "n_items", "n_flagged", "n_failed"}.
    """
    if kind not in EXTRACT_KINDS:
        raise ValueError(kind)
    model = model or _model()
    system = guard.with_doc_rule(load_prompt(kind))
    ph = prompt_hash(system)
    radar_db.init_radar_db(radar_path)
    conn = radar_db.open_read(radar_path)
    try:
        done = _done_refs(conn, kind, [d.ref for d in docs], ph, model)
    finally:
        conn.close()
    todo = [d for d in docs if d.ref not in done and d.text.strip()]
    size = max(1, batch or config.RADAR_EXTRACT_BATCH)
    stats = {"n_docs": len(todo), "n_calls": 0, "n_items": 0, "n_flagged": 0, "n_failed": 0}
    for i in range(0, len(todo), size):
        chunk = todo[i:i + size]
        user = "\n".join(guard.doc_block(f"d{j}", d.text, url=d.url) for j, d in enumerate(chunk))
        stats["n_calls"] += 1
        try:
            raw = llm.call(f"radar_{kind}", model, system, user, schema=_extract_schema(kind), prompt_hash=ph,
                           max_tokens=160 * _ITEM_MAX[kind] * len(chunk) + 80, required=("docs",))
        except LLMError as e:
            stats["n_failed"] += len(chunk)
            if progress:
                progress(f"{kind} 추출 실패({len(chunk)}건): {e}")
            continue
        by_id = {str(x.get("id")): x for x in raw.get("docs") or [] if isinstance(x, dict)}
        rows, now = [], _now()
        for j, d in enumerate(chunk):
            got = by_id.get(f"d{j}")
            if got is None:
                stats["n_failed"] += 1
                continue
            flagged = guard.screen_doc(d.text, bool(got.get("inj")))
            stats["n_flagged"] += int(flagged)
            items = []
            for it in (got.get("items") or [])[:_ITEM_MAX[kind]]:
                text = " ".join(str(it.get("text") or "").split())[:_TEXT_MAX]
                if not text or guard.looks_injected(text):
                    continue
                quote = guard.kept_quote(clip_quote(str(it.get("quote") or ""), config.QUOTE_MAX_CHARS), d.text, flagged)
                items.append((text, " ".join(str(it.get("search_en") or "").split())[:120], quote))
            for text, en, quote in items or [("", "", "")]:
                rows.append((kind, d.ref, text, quote, hashlib.sha256(quote.encode()).hexdigest()[:16] if quote else None,
                             int(flagged), model, ph, now, en))
            stats["n_items"] += len(items)
        if rows:
            w = radar_db.open_write(radar_path)
            try:
                with w:
                    w.executemany("INSERT INTO radar_extracts(kind, item_ref, text, quote, quote_hash, injection_flag,"
                                  " model, prompt_hash, created_at, search_en) VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
            finally:
                w.close()
        if progress:
            progress(f"{kind} 추출 {min(i + size, len(todo))}/{len(todo)}")
    return stats


def extracts(conn, kind: str, *, refs: list[str] | None = None, include_flagged: bool = False) -> list[dict]:
    """최신 프롬프트·모델과 무관하게 저장된 추출 중 내용 있는 것. 같은 문서의 옛 프롬프트 결과는 최신 것만."""
    sql = ("SELECT x.*, s.published_at, s.layer FROM radar_extracts x LEFT JOIN signal_items s ON s.id = x.item_ref"
           " WHERE x.kind=? AND x.text != '' AND x.created_at = (SELECT MAX(created_at) FROM radar_extracts y"
           " WHERE y.kind = x.kind AND y.item_ref = x.item_ref)")
    args: list = [kind]
    if not include_flagged:
        sql += " AND x.injection_flag = 0"
    if refs is not None:
        if not refs:
            return []
        sql += f" AND x.item_ref IN ({','.join('?' * len(refs))})"
        args += refs
    return [dict(r) for r in conn.execute(sql + " ORDER BY x.id", args)]


# ---- 입력 문서 만들기 ----

def report_doc(pp_conn, report_id: str) -> tuple[Doc, int | None]:
    """painpointer.db 리포트 → 필요 추출 문서(불편 문장 + 원문 인용), 등장 월 수(왜-지금 (a))."""
    r = pp_conn.execute("SELECT query_json, metrics_json, report_json FROM reports WHERE id=?", (report_id,)).fetchone()
    if r is None:
        raise KeyError(f"리포트 없음: {report_id}")
    q, m, rep = json.loads(r[0]), json.loads(r[1]), json.loads(r[2])
    quotes = [x.get("text", "") for x in rep.get("quotes") or [] if isinstance(x, dict)][:8]
    text = "불편: " + q.get("pain", "") + "\n" + "\n".join(f"인용: {t}" for t in quotes if t)
    return Doc(ref=f"report:{report_id}", text=text), m.get("months_present")


def openalex_docs(oa_source, work_ids: list[str]) -> list[Doc]:
    """L2 논문 항목 → 능력·한계 추출 문서(제목 + 초록). 원문은 저장하지 않으므로 추출할 때 다시 받는다."""
    out = []
    for i in range(0, len(work_ids), 50):
        ids = [short_id(w.split(":", 1)[-1]) for w in work_ids[i:i + 50]]
        data = oa_source.oa("works", {"filter": "openalex:" + "|".join(ids), "per_page": 50,
                                      "select": "id,display_name,abstract_inverted_index,publication_date,doi"})
        for w in data.get("results") or []:
            body = abstract_text(w.get("abstract_inverted_index"))
            if body:
                out.append(Doc(ref=f"openalex:{short_id(w['id'])}", text=f"{w.get('display_name') or ''}\n{body}",
                               url=w.get("doi") or w.get("id"), published_at=w.get("publication_date")))
    return out


# ---------------------------------------------------------------- LLM 확인(공용)

_CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {"judgments": {"type": "array", "items": {
        "type": "object",
        "properties": {"candidate_id": {"type": "string"}, "yes": {"type": "boolean"}, "reason": {"type": "string"},
                       "inj": {"type": "boolean"}},
        "required": ["candidate_id", "yes", "reason", "inj"], "additionalProperties": False}}},
    "required": ["judgments"], "additionalProperties": False,
}


def confirm(llm: LLM, relation: str, item_text: str, candidates: list[tuple[str, str]], *,
            model: str | None = None) -> tuple[dict[str, tuple[bool, str]], str]:
    """후보마다 (관계 성립?, 근거 한 문장). 응답에 빠진 후보·인젝션 표시 후보는 no. 반환 (판정, prompt_hash)."""
    model = model or _model()
    system = guard.with_doc_rule(load_prompt("confirm"))
    ph = prompt_hash(system)
    if not candidates:
        return {}, ph
    user = f"관계: {relation}\n" + guard.doc_block("item", item_text) + "\n" + "\n".join(
        guard.doc_block(f"c{i}", text) for i, (_, text) in enumerate(candidates))
    raw = llm.call(f"radar_confirm_{relation}", model, system, user, schema=_CONFIRM_SCHEMA, prompt_hash=ph,
                   max_tokens=60 * len(candidates) + 80, required=("judgments",))
    got = {str(j.get("candidate_id")): j for j in raw.get("judgments") or [] if isinstance(j, dict)}
    out = {}
    for i, (cid, text) in enumerate(candidates):
        j = got.get(f"c{i}") or {}
        bad = bool(j.get("inj")) or guard.looks_injected(text) or guard.looks_injected(item_text)
        out[cid] = (bool(j.get("yes")) and not bad, " ".join(str(j.get("reason") or "").split())[:120])
    return out, ph


# ---------------------------------------------------------------- 토픽 매핑

def topic_matrix(conn, embedder) -> tuple[list[str], np.ndarray, dict[str, str]]:
    """분야에 배정된 토픽의 (id 목록, 임베딩, id → '이름: 설명'). 분야 중심 벡터와 같은 문장(fields.topic_text)."""
    rows = conn.execute("SELECT id, name, description FROM topics WHERE field_id IS NOT NULL ORDER BY id").fetchall()
    texts = {r["id"]: f"{r['name']}: {r['description']}".strip(": ") for r in rows}
    ids = list(texts)
    M = embedder.encode([texts[i] for i in ids]) if ids else np.zeros((0, 1))
    return ids, np.asarray(M, dtype=np.float32), texts


def map_topics(item_layer: int, item_id: str, text: str, *, embedder, llm: LLM, radar_path=None,
               topics=None, top: int | None = None, threshold: float | None = None) -> str | None:
    """항목 하나 → 주 토픽(통과한 매핑 중 점수 최고) 또는 None('토픽 없음'). topic_links에 판정을 남긴다."""
    conn = radar_db.open_read(radar_path)
    try:
        ids, M, texts = topics or topic_matrix(conn, embedder)
    finally:
        conn.close()
    if not ids:
        return None
    s = _sims(embedder.encode([text])[0], M)
    thr = config.TOPIC_LINK_MIN if threshold is None else threshold
    cand = [(ids[j], float(s[j])) for j in np.argsort(-s, kind="stable")[:top or config.TOPIC_LINK_TOP] if s[j] >= thr]
    if not cand:
        return None
    verdict, ph = confirm(llm, "topic", text, [(t, texts[t]) for t, _ in cand])
    model, now = _model(), _now()
    w = radar_db.open_write(radar_path)
    try:
        with w:
            w.executemany("INSERT OR REPLACE INTO topic_links(item_layer, item_id, topic_id, score, judgment, evidence,"
                          " model, prompt_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                          [(item_layer, item_id, t, sc, "yes" if verdict[t][0] else "no", verdict[t][1], model, ph, now)
                           for t, sc in cand])
    finally:
        w.close()
    passed = [(t, sc) for t, sc in cand if verdict[t][0]]
    return max(passed, key=lambda x: x[1])[0] if passed else None


def native_topic(conn, item_id: str) -> str | None:
    """원천이 이미 준 주 토픽(OpenAlex 논문 primary_topic). 레이더 분야 토픽일 때만. 이런 항목은 매핑 LLM을 부르지 않는다."""
    r = conn.execute("SELECT t.id FROM signal_items s JOIN topics t ON t.id = json_extract(s.metrics_json, '$.topic_id')"
                     " WHERE s.id=?", (item_id,)).fetchone()
    return r[0] if r else None


def primary_topic(conn, item_id: str) -> str | None:
    """항목의 주 토픽: 원천 토픽(OpenAlex) → 없으면 통과한 매핑 중 점수 최고."""
    nt = native_topic(conn, item_id)
    if nt:
        return nt
    r = conn.execute("SELECT topic_id FROM topic_links WHERE item_id=? AND judgment='yes' ORDER BY score DESC, id"
                     " LIMIT 1", (item_id,)).fetchone()
    return r[0] if r else None


# ---------------------------------------------------------------- 사건 범주 매핑(D5)

def _cwe_names() -> dict[str, dict]:
    try:
        return json.loads(_CWE_PATH.read_text(encoding="utf-8"))["entries"]
    except (OSError, ValueError, KeyError):
        return {}


def incident_categories(conn) -> list[tuple[str, str, str]]:
    """(피드, 범주, 비교 문장). 피드 범주 시계열(KEV·NVD·AIID)에 있는 범주 중 이름을 아는 것만.
    CWE 이름·첫 문장은 MITRE CWE-1000 뷰 스냅샷(data/cwe_names.json). 뷰 밖 옛 범주(CWE-264 등)는 빠진다."""
    names = _cwe_names()
    out = []
    for (tid,) in conn.execute("SELECT DISTINCT topic_id FROM topic_series WHERE metric='incidents' AND topic_id NOT LIKE '%:*'"
                               " ORDER BY topic_id"):
        feed, cat = tid.split(":", 1)
        n = names.get(cat)
        if n:
            out.append((feed, cat, f"{cat} {n['name']}. {n['desc']}"))
    return out


def map_incidents(extract_id: int, text: str, *, embedder, llm: LLM, radar_path=None, categories=None,
                  top: int | None = None, threshold: float | None = None) -> list[tuple[str, str, float]]:
    """필요·능력 문장 하나 → 통과한 (피드, 범주, 점수). 같은 범주가 여러 피드에 있으면 범주 문장은 한 번만 확인한다."""
    conn = radar_db.open_read(radar_path)
    try:
        cats = categories if categories is not None else incident_categories(conn)
    finally:
        conn.close()
    if not cats:
        return []
    labels = sorted({c[2] for c in cats})
    s = _sims(embedder.encode([text])[0], np.asarray(embedder.encode(labels), dtype=np.float32))
    thr = config.INCIDENT_LINK_MIN if threshold is None else threshold
    best = [(labels[j], float(s[j])) for j in np.argsort(-s, kind="stable")[:top or config.INCIDENT_LINK_TOP] if s[j] >= thr]
    if not best:
        return []
    verdict, ph = confirm(llm, "incident", text, [(lab, lab) for lab, _ in best])
    score = dict(best)
    rows, now, model = [], _now(), _model()
    for feed, cat, lab in cats:
        if lab in score:
            rows.append((extract_id, feed, cat, score[lab], "yes" if verdict[lab][0] else "no", verdict[lab][1],
                         model, ph, now))
    w = radar_db.open_write(radar_path)
    try:
        with w:
            w.executemany("INSERT OR REPLACE INTO incident_links(extract_id, feed, category, score, judgment, evidence,"
                          " model, prompt_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)", rows)
    finally:
        w.close()
    return [(r[1], r[2], r[3]) for r in rows if r[4] == "yes"]


def category_ratio(conn, feed: str, category: str, today: date) -> tuple[float | None, dict]:
    """피드 점유율 변화 비율 = (최근 6개월 범주 건수 / 피드 건수) ÷ (직전 6개월 같은 비율). 직전 0건이면 None."""
    end = last_full_month(today)
    k = config.INCIDENT_WINDOW_MONTHS
    cur = [shift_month(end, -i) for i in range(k)]
    prev = [shift_month(end, -k - i) for i in range(k)]

    def share(months):
        q = ",".join("?" * len(months))
        r = conn.execute(f"SELECT SUM(value), SUM(denom) FROM topic_series WHERE topic_id=? AND metric='incidents'"
                         f" AND period IN ({q})", (f"{feed}:{category}", *months)).fetchone()
        tot = conn.execute(f"SELECT SUM(value) FROM topic_series WHERE topic_id=? AND metric='incidents'"
                           f" AND period IN ({q})", (f"{feed}:*", *months)).fetchone()[0]
        return (r[0] or 0), (tot or 0)

    (cn, ct), (pn, pt) = share(cur), share(prev)
    detail = {"recent": [cn, ct], "previous": [pn, pt], "window": [cur[-1], cur[0], prev[-1], prev[0]]}
    if not ct or not pt or not pn:
        return None, detail
    return round((cn / ct) / (pn / pt), 4), detail


def incident_axis(conn, extract_ids: list[int], today: date) -> dict:
    """공식 사건 축(D5): 통과한 매핑 중 점수 최고 범주 1개의 변화 비율. 나머지는 others(보조 목록)."""
    if not extract_ids:
        return {"status": "unmeasured", "reason": "no_mapping"}
    q = ",".join("?" * len(extract_ids))
    rows = conn.execute(f"SELECT feed, category, MAX(score) AS score FROM incident_links WHERE judgment='yes'"
                        f" AND extract_id IN ({q}) GROUP BY feed, category ORDER BY score DESC, feed, category",
                        extract_ids).fetchall()
    if not rows:
        return {"status": "unmeasured", "reason": "no_mapping"}
    links = []
    for r in rows:
        ratio, detail = category_ratio(conn, r["feed"], r["category"], today)
        links.append({"feed": r["feed"], "category": r["category"], "score": round(r["score"], 4), "ratio": ratio,
                      "detail": detail})
    top = links[0]
    if top["ratio"] is None:
        return {"status": "unmeasured", "reason": "no_baseline", **top, "others": links[1:]}
    return {"status": "measured", "value": top["ratio"], **top, "others": links[1:]}


# ---------------------------------------------------------------- 필요 ↔ 능력 간선

_EDGE_SCHEMA = {
    "type": "object",
    "properties": {"judgments": {"type": "array", "items": {
        "type": "object",
        "properties": {"capability_id": {"type": "string"}, "yes": {"type": "boolean"}, "reason": {"type": "string"},
                       "inj": {"type": "boolean"}},
        "required": ["capability_id", "yes", "reason", "inj"], "additionalProperties": False}}},
    "required": ["judgments"], "additionalProperties": False,
}


def _x_text(x: dict) -> str:
    return x["text"] + (f"\n인용: {x['quote']}" if x.get("quote") else "")


def _ensure_evidence(conn, kind: str, ref_id: str, summary: str, url: str | None, today: str) -> str:
    eid = f"{kind}:{ref_id}"
    conn.execute("INSERT OR IGNORE INTO evidence(id, kind, ref_id, summary, url, snapshot_date, created_at)"
                 " VALUES (?,?,?,?,?,?,?)", (eid, kind, ref_id, summary[:200], url, today, _now()))
    return eid


def build_edges(need_ids: list[int], *, embedder, llm: LLM, radar_path=None, top_k: int | None = None,
                threshold: float | None = None, progress=None) -> dict:
    """필요마다 임베딩 최근접 능력 상위 k(임계 이상) → LLM 판정 → need_capability_edges.
    이미 같은 프롬프트·모델로 판정한 쌍은 건너뛴다. 플래그 추출은 후보에서 뺀다. 반환 {n_pairs, n_yes, n_calls}."""
    model = model_ = _model()
    system = guard.with_doc_rule(load_prompt("edge"))
    ph = prompt_hash(system)
    conn = radar_db.open_read(radar_path)
    try:
        caps = extracts(conn, "capability")
        needs = {x["id"]: x for x in extracts(conn, "need") if x["id"] in set(need_ids)}
        done = {(r[0], r[1]) for r in conn.execute("SELECT need_id, capability_id FROM need_capability_edges"
                                                   " WHERE model=? AND prompt_hash=?", (model, ph))}
    finally:
        conn.close()
    stats = {"n_pairs": 0, "n_yes": 0, "n_calls": 0}
    if not caps or not needs:
        return stats
    C = np.asarray(embedder.encode([c["text"] for c in caps]), dtype=np.float32)
    thr = config.EDGE_CAND_MIN if threshold is None else threshold
    today = date.today().isoformat()
    for nid, need in needs.items():
        s = _sims(embedder.encode([need["text"]])[0], C)
        cand = [(caps[j], float(s[j])) for j in np.argsort(-s, kind="stable")[:top_k or config.EDGE_TOP_K]
                if s[j] >= thr and (nid, caps[j]["id"]) not in done]
        if not cand:
            continue
        user = (guard.doc_block("need", _x_text(need)) + "\n"
                + "\n".join(guard.doc_block(f"cap{c['id']}", _x_text(c)) for c, _ in cand))
        stats["n_calls"] += 1
        try:
            raw = llm.call("radar_edge", model_, system, user, schema=_EDGE_SCHEMA, prompt_hash=ph,
                           max_tokens=70 * len(cand) + 80, required=("judgments",))
        except LLMError as e:
            if progress:
                progress(f"간선 판정 실패(필요 {nid}): {e}")
            continue
        got = {str(j.get("capability_id")): j for j in raw.get("judgments") or [] if isinstance(j, dict)}
        w = radar_db.open_write(radar_path)
        try:
            with w:
                for c, sc in cand:
                    j = got.get(f"cap{c['id']}") or {}
                    yes = bool(j.get("yes")) and not j.get("inj")
                    ev = [_ensure_evidence(w, "extract", str(need["id"]), need["text"], None, today),
                          _ensure_evidence(w, "extract", str(c["id"]), c["text"], None, today)]
                    w.execute("INSERT OR REPLACE INTO need_capability_edges(need_id, capability_id, score, judgment,"
                              " evidence_ids_json, model, prompt_hash, created_at) VALUES (?,?,?,?,?,?,?,?)",
                              (nid, c["id"], round(sc, 4), "yes" if yes else "no", json.dumps(ev), model, ph, _now()))
                    stats["n_pairs"] += 1
                    stats["n_yes"] += int(yes)
        finally:
            w.close()
    return stats


# ---------------------------------------------------------------- 왜-지금(D14)

@dataclass
class WhyNow:
    strength: str                                   # strong | mid | weak | unmeasured
    conditions: dict = field(default_factory=dict)  # a·b·c → {status: met|unmet|unmeasured, ...근거}
    readiness: dict = field(default_factory=dict)   # 관심·준비도(표시만, 강도에 안 씀)

    def to_dict(self) -> dict:
        return asdict(self)


def judge_why_now(months: int | None, n_limits: int | None, c1: bool | None, c2_claims: int | None, *,
                  min_months: int | None = None, min_claims: int | None = None) -> WhyNow:
    """판정표(모듈 설명) 그대로의 순수 함수. None = 미측정."""
    mm = config.WHYNOW_MIN_MONTHS if min_months is None else min_months
    mc = config.WHYNOW_MIN_CLAIMS if min_claims is None else min_claims

    def st(v, ok):
        return "unmeasured" if v is None else ("met" if ok(v) else "unmet")

    a = {"status": st(months, lambda v: v >= mm), "months": months, "min": mm}
    b = {"status": st(n_limits, lambda v: v >= 1), "n_limits": n_limits}
    if c1 is True or (c2_claims is not None and c2_claims >= mc):
        cs = "met"
    elif c1 is None and c2_claims is None:
        cs = "unmeasured"
    else:
        cs = "unmet"
    c = {"status": cs, "c1_sota_improved": c1, "c2_claims": c2_claims, "min_claims": mc}
    conds = {"a": a, "b": b, "c": c}
    n_un = sum(x["status"] == "unmeasured" for x in conds.values())
    n_met = sum(x["status"] == "met" for x in conds.values())
    strength = "unmeasured" if n_un >= 2 else {3: "strong", 2: "mid"}.get(n_met, "weak")
    return WhyNow(strength, conds)


def _judged(conn, kind: str, a_ref: str, model: str, ph: str) -> dict[str, str]:
    return {r[0]: r[1] for r in conn.execute("SELECT b_ref, judgment FROM link_judgments WHERE kind=? AND a_ref=?"
                                             " AND model=? AND prompt_hash=?", (kind, a_ref, model, ph))}


def _confirm_cached(kind: str, a_ref: str, a_text: str, cands: list[tuple[str, str, float]], *, llm: LLM,
                    radar_path=None) -> list[str]:
    """link_judgments 캐시를 거쳐 확인. cands = (b_ref, 문장, 점수). 반환: 통과한 b_ref."""
    model = _model()
    ph = prompt_hash(guard.with_doc_rule(load_prompt("confirm")))
    conn = radar_db.open_read(radar_path)
    try:
        prev = _judged(conn, kind, a_ref, model, ph)
    finally:
        conn.close()
    todo = [c for c in cands if c[0] not in prev]
    if todo:
        verdict, ph = confirm(llm, kind, a_text, [(b, t) for b, t, _ in todo])
        w = radar_db.open_write(radar_path)
        try:
            with w:
                for b, _, sc in todo:
                    yes, why = verdict[b]
                    w.execute("INSERT OR REPLACE INTO link_judgments(kind, a_ref, b_ref, score, judgment, evidence, model,"
                              " prompt_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                              (kind, a_ref, b, round(sc, 4), "yes" if yes else "no", why, model, ph, _now()))
                    prev[b] = "yes" if yes else "no"
        finally:
            w.close()
    return [b for b, _, _ in cands if prev.get(b) == "yes"]


def _top(q: np.ndarray, rows: list, texts: list[str], embedder, k: int, thr: float) -> list[tuple[dict, float]]:
    if not rows:
        return []
    s = _sims(q, np.asarray(embedder.encode(texts), dtype=np.float32))
    return [(rows[j], float(s[j])) for j in np.argsort(-s, kind="stable")[:k] if s[j] >= thr]


def topic_growth(conn, topic_id: str | None) -> float | None:
    """L2 점유율 증가율(최근 12개월 점유율 / 직전 12개월). 관심·준비도 표시용."""
    if not topic_id:
        return None
    r = conn.execute("SELECT period, value, denom FROM topic_series WHERE topic_id=? AND layer=2 AND metric='works_12m'"
                     " ORDER BY period DESC LIMIT 2", (topic_id,)).fetchall()
    if len(r) < 2 or not r[0]["denom"] or not r[1]["denom"] or not r[1]["value"]:
        return None
    return round((r[0]["value"] / r[0]["denom"]) / (r[1]["value"] / r[1]["denom"]), 4)


def why_now_for_edge(edge_id: int, *, pain_months: int | None, embedder, llm: LLM, radar_path=None,
                     today: date | None = None) -> WhyNow:
    """간선 하나의 왜-지금. (b) 한계 대응, (c1) 한계 ↔ 벤치마크, (c2) 한계 ↔ 최근 논문 해결 주장을 확인한다."""
    today = today or date.today()
    thr = config.LIMIT_MATCH_MIN
    conn = radar_db.open_read(radar_path)
    try:
        e = conn.execute("SELECT * FROM need_capability_edges WHERE id=?", (edge_id,)).fetchone()
        if e is None:
            raise KeyError(f"간선 없음: {edge_id}")
        need = conn.execute("SELECT * FROM radar_extracts WHERE id=?", (e["need_id"],)).fetchone()
        cap = conn.execute("SELECT * FROM radar_extracts WHERE id=?", (e["capability_id"],)).fetchone()
        limits = extracts(conn, "limit")
        benches = [dict(r) for r in conn.execute("SELECT id, title, metrics_json, published_at FROM signal_items"
                                                 " WHERE layer=5 AND kind='sota' AND injection_flag=0 ORDER BY id")]
        since = (today - timedelta(days=365)).isoformat()
        recent = [x for x in extracts(conn, "capability") if x.get("layer") == 2 and (x.get("published_at") or "") >= since]
        cap_topic = primary_topic(conn, cap["item_ref"])
        readiness = {"topic_id": cap_topic, "topic_growth": topic_growth(conn, cap_topic)}
    finally:
        conn.close()

    if not limits:
        w = judge_why_now(pain_months, None, None, None)
        w.readiness = readiness
        return w
    q = _unit(_unit(embedder.encode([need["text"]])[0]) + _unit(embedder.encode([cap["text"]])[0]))
    cand = _top(q, limits, [x["text"] for x in limits], embedder, 5, thr)
    pair = f"필요: {need['text']}\n능력: {cap['text']}"
    matched_refs = _confirm_cached("edge_limit", f"edge:{edge_id}", pair,
                                   [(f"extract:{x['id']}", _x_text(x), sc) for x, sc in cand], llm=llm, radar_path=radar_path)
    matched = [x for x in limits if f"extract:{x['id']}" in set(matched_refs)]

    c1: bool | None = None if not benches else False
    c2: int | None = None if not recent else 0
    detail = {"limits": [x["id"] for x in matched], "benchmarks": [], "claims": {}}
    for lim in matched:
        lq = embedder.encode([lim["text"]])[0]
        if benches:
            bc = _top(lq, benches, [b["title"] for b in benches], embedder, 3, thr)
            ok = _confirm_cached("limit_benchmark", f"extract:{lim['id']}", lim["text"],
                                 [(b["id"], b["title"], sc) for b, sc in bc], llm=llm, radar_path=radar_path)
            for b in benches:
                if b["id"] in ok:
                    imp = json.loads(b["metrics_json"] or "{}").get("improvement_12m")
                    detail["benchmarks"].append({"id": b["id"], "improvement_12m": imp})
                    if imp is not None and imp > 0:
                        c1 = True
        if recent:
            rc = _top(lq, recent, [x["text"] for x in recent], embedder, 5, thr)
            ok = set(_confirm_cached("limit_resolution", f"extract:{lim['id']}", lim["text"],
                                     [(f"extract:{x['id']}", _x_text(x), sc) for x, sc in rc], llm=llm,
                                     radar_path=radar_path))
            papers = sorted({x["item_ref"] for x in recent if f"extract:{x['id']}" in ok})
            detail["claims"][lim["id"]] = papers
            c2 = max(c2 or 0, len(papers))
    w = judge_why_now(pain_months, len(matched), c1, c2)
    w.conditions["b"]["limit_ids"] = detail["limits"]
    w.conditions["c"]["benchmarks"] = detail["benchmarks"]
    w.conditions["c"]["claims"] = detail["claims"]
    w.readiness = readiness
    return w


# ---------------------------------------------------------------- 빈자리 고정 검색 규약(D15)

@dataclass
class SupplyHit:
    source: str
    key: str
    title: str
    text: str = ""
    url: str | None = None


class SupplySource:
    """공급 원천: search(질의, k) → 상위 k. lang = 이 원천에 보낼 질의 언어(ko: 한국어 문장, en: 영어 검색 구).
    키가 없으면 SourceUnavailable, 응답 이상은 SourceError — 둘 다 그 카드의 빈자리를 '미측정'으로 만든다."""
    name = "base"
    lang = "ko"

    def search(self, query: str, k: int) -> list[SupplyHit]:
        raise NotImplementedError


class HaniumSupply(SupplySource):
    """한이음 공개 프로젝트·수상작(painpointer.db attempt_embeddings, 사전 계산)에서 임베딩 최근접."""
    name = "hanium"

    def __init__(self, db_path, embedder):
        self.db_path, self.embedder = db_path, embedder
        self._rows = None

    def search(self, query, k):
        from .. import db
        from ..embed import _unblob
        if self._rows is None:
            conn = db.open_read(self.db_path)
            try:
                self._rows = conn.execute("SELECT project_id, title, url, vector FROM attempt_embeddings WHERE model=?",
                                          (self.embedder.model_name,)).fetchall()
            finally:
                conn.close()
            if not self._rows:
                raise SourceUnavailable("hanium: 현재 임베딩 모델의 한이음 벡터 없음(precompute-attempts 필요)")
            self._M = np.stack([_unblob(r["vector"]) for r in self._rows])
        s = _sims(self.embedder.encode([query])[0], self._M)
        return [SupplyHit("hanium", self._rows[j]["project_id"], self._rows[j]["title"], self._rows[j]["title"],
                          self._rows[j]["url"]) for j in np.argsort(-s, kind="stable")[:k]]


class OpenAlexSupply(SupplySource):
    name = "openalex"
    lang = "en"

    def __init__(self, oa_source):
        self.src = oa_source

    def search(self, query, k):
        data = self.src.oa("works", {"search": query, "per_page": k,
                                     "select": "id,display_name,abstract_inverted_index,doi"})
        return [SupplyHit("openalex", short_id(w["id"]), w.get("display_name") or "",
                          f"{w.get('display_name') or ''} {abstract_text(w.get('abstract_inverted_index'))[:300]}",
                          w.get("doi") or w["id"]) for w in data.get("results") or []]


class GooglePlaySupply(SupplySource):
    name = "googleplay"

    def __init__(self, search_fn=None):
        self._fn = search_fn

    def search(self, query, k):
        fn = self._fn
        if fn is None:
            from google_play_scraper import search as fn
        try:
            res = fn(query, lang="ko", country="kr", n_hits=k)
        except Exception as e:   # 라이브러리 내부 파싱 오류까지 실패로 기록
            raise SourceError(f"googleplay: {type(e).__name__}: {e}") from e
        return [SupplyHit("googleplay", r["appId"], r.get("title") or "",
                          f"{r.get('title') or ''} {(r.get('summary') or r.get('description') or '')[:300]}",
                          f"https://play.google.com/store/apps/details?id={r['appId']}") for r in res if r.get("appId")]


class _XmlKeySupply(SupplySource):
    """키가 필요한 공공 API(KIPRIS·NTIS). 키 발급 전이라 실응답 형식은 확인하지 못했다 — 예상 태그가 없으면 SourceError."""
    key_env = ""
    url = ""
    item_tag = title_tag = id_tag = text_tag = ""

    def __init__(self, http=None, env=None):
        import os

        import httpx
        self.http = http or httpx.Client(timeout=30, follow_redirects=True)
        self.env = env if env is not None else os.environ

    def params(self, query, k, key) -> dict:
        raise NotImplementedError

    def search(self, query, k):
        import xml.etree.ElementTree as ET
        key = self.env.get(self.key_env, "")
        if not key:
            raise SourceUnavailable(f"{self.name}: {self.key_env} 없음")
        try:
            r = self.http.get(self.url, params=self.params(query, k, key))
        except Exception as e:
            raise SourceError(f"{self.name}: 연결 실패 {type(e).__name__}") from e
        if r.status_code >= 400:
            raise SourceError(f"{self.name}: HTTP {r.status_code}")
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError as e:
            raise SourceError(f"{self.name}: XML 아님") from e
        items = root.iter(self.item_tag)
        out = []
        for it in items:
            title = " ".join((it.findtext(self.title_tag) or "").split())
            if title:
                out.append(SupplyHit(self.name, (it.findtext(self.id_tag) or title)[:80], title,
                                     f"{title} {(it.findtext(self.text_tag) or '')[:300]}"))
        if not out and root.find(f".//{self.item_tag}") is None and "totalCount" not in r.text and "TOTALHITS" not in r.text:
            raise SourceError(f"{self.name}: 예상 태그 <{self.item_tag}> 없음(형식 확인 필요)")
        return out[:k]


class KiprisSupply(_XmlKeySupply):
    name, key_env = "kipris", "PP_KIPRIS_KEY"
    url = "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getWordSearch"
    item_tag, title_tag, id_tag, text_tag = "item", "inventionTitle", "applicationNumber", "astrtCont"

    def params(self, query, k, key):
        return {"word": query, "year": 0, "numOfRows": k, "pageNo": 1, "ServiceKey": key}


class NtisSupply(_XmlKeySupply):
    name, key_env = "ntis", "PP_NTIS_KEY"
    url = "https://www.ntis.go.kr/rndopen/openApi/public_project"
    item_tag, title_tag, id_tag, text_tag = "HIT", "ProjectTitle/Korean", "ProjectNumber", "Abstract/Korean"

    def params(self, query, k, key):
        return {"apprvKey": key, "collection": "project", "query": query, "displayCnt": k}


def default_supply(*, db_path, embedder, oa_source) -> list[SupplySource]:
    return [HaniumSupply(db_path, embedder), OpenAlexSupply(oa_source), KiprisSupply(), GooglePlaySupply(), NtisSupply()]


@dataclass
class GapResult:
    search_id: str
    status: str                 # measured | unmeasured
    gap_count: int | None
    sources: dict
    failed: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


_TITLE_NORM = re.compile(r"[\W_]+", re.UNICODE)


def _norm_title(t: str) -> str:
    return _TITLE_NORM.sub("", (t or "").lower())


def protocol(embedder, names: list[str]) -> dict:
    return {"sources": names, "top": config.SUPPLY_TOP, "sim_min": {n: config.SUPPLY_SIM_MIN.get(n, 0.5) for n in names},
            "dup_min": config.SUPPLY_DUP_MIN, "embed_model": embedder.model_name, "queries": ["need", "capability", "both"]}


def gap_search(need: dict, cap: dict, *, sources: list[SupplySource], embedder, radar_path=None,
               today: date | None = None, reuse: bool = True) -> GapResult:
    """고정 검색 규약. need·cap = radar_extracts 행(text, search_en). 원천 목록이 규약(SUPPLY_SOURCES)과 다르면 거부한다."""
    names = [s.name for s in sources]
    if sorted(names) != sorted(config.SUPPLY_SOURCES):
        raise ValueError(f"빈자리 규약 원천은 {config.SUPPLY_SOURCES} 전부여야 합니다(받음: {names})")
    today = today or date.today()
    ko = [need["text"], cap["text"], f"{need['text']} {cap['text']}"]
    en_n, en_c = need.get("search_en") or need["text"], cap.get("search_en") or cap["text"]
    en = [en_n, en_c, f"{en_n} {en_c}"]
    proto = protocol(embedder, names)
    sid = hashlib.sha256(json.dumps([ko, en, proto], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]
    if reuse:
        conn = radar_db.open_read(radar_path)
        try:
            r = conn.execute("SELECT * FROM supply_searches WHERE id=?", (sid,)).fetchone()
        finally:
            conn.close()
        if r is not None and r["searched_at"][:10] >= (today - timedelta(days=config.SUPPLY_TTL_DAYS)).isoformat():
            src = json.loads(r["sources_json"])
            return GapResult(sid, r["status"], r["gap_count"], src, [n for n, v in src.items() if v["status"] != "ok"])

    qv = {"ko": np.asarray(embedder.encode(ko), dtype=np.float32), "en": np.asarray(embedder.encode(en), dtype=np.float32)}
    per, hits = {}, []                     # hits: (SupplyHit, score, similar)
    for s in sources:
        qs = en if s.lang == "en" else ko
        try:
            got: dict[str, SupplyHit] = {}
            for q in qs:
                for h in s.search(q, config.SUPPLY_TOP)[:config.SUPPLY_TOP]:
                    got.setdefault(h.key, h)
        except (SourceUnavailable, SourceError) as e:
            per[s.name] = {"status": "failed", "error": str(e)[:200], "n_hits": 0, "n_similar": 0}
            continue
        items = list(got.values())
        sim_min = proto["sim_min"][s.name]
        if items:
            V = _unit(np.asarray(embedder.encode([h.text or h.title for h in items]), dtype=np.float32))
            sc = (V @ _unit(qv[s.lang]).T).max(axis=1)
        else:
            sc = np.zeros(0)
        n_sim = 0
        for h, v in zip(items, sc):
            hits.append((h, float(v), float(v) >= sim_min))
            n_sim += int(float(v) >= sim_min)
        per[s.name] = {"status": "ok", "n_hits": len(items), "n_similar": n_sim}

    # 중복: 유사 항목끼리 점수 높은 순으로 대표를 정한다. 같은 원천 안에서는 제목·URL이 같을 때만
    # (한이음 같은 제목 여러 행, OpenAlex 프리프린트·게재본), 원천 간에는 임베딩 ≥ 0.9도 같은 시도로 본다
    sim = sorted([x for x in hits if x[2]], key=lambda x: -x[1])
    dup_of: dict[tuple[str, str], str] = {}
    kept: list[SupplyHit] = []
    KV = _unit(np.asarray(embedder.encode([h.text or h.title for h, _, _ in sim]), dtype=np.float32)) if sim else None
    kept_idx: list[int] = []
    for i, (h, _, _) in enumerate(sim):
        rep = None
        for j in kept_idx:
            k = sim[j][0]
            same_doc = (h.url and h.url == k.url) or (_norm_title(h.title) and _norm_title(h.title) == _norm_title(k.title))
            if same_doc or (k.source != h.source and float(KV[i] @ KV[j]) >= config.SUPPLY_DUP_MIN):
                rep = f"{k.source}:{k.key}"
                break
        if rep:
            dup_of[(h.source, h.key)] = rep
        else:
            kept_idx.append(i)
            kept.append(h)
    failed = [n for n, v in per.items() if v["status"] != "ok"]
    status = "measured" if not failed else "unmeasured"
    gap = len(kept) if status == "measured" else None
    w = radar_db.open_write(radar_path)
    try:
        with w:
            w.execute("DELETE FROM supply_hits WHERE search_id=?", (sid,))
            w.execute("INSERT OR REPLACE INTO supply_searches(id, need_id, capability_id, queries_json, protocol_json,"
                      " status, sources_json, gap_count, searched_at) VALUES (?,?,?,?,?,?,?,?,?)",
                      (sid, need.get("id"), cap.get("id"), json.dumps({"ko": ko, "en": en}, ensure_ascii=False),
                       json.dumps(proto), status, json.dumps(per, ensure_ascii=False), gap, _now()))
            w.executemany("INSERT OR REPLACE INTO supply_hits(search_id, source, item_key, title, snippet, url, score,"
                          " similar, dup_of) VALUES (?,?,?,?,?,?,?,?,?)",
                          [(sid, h.source, h.key, h.title[:200], (h.text or h.title)[:300], h.url, round(sc, 4), int(simf),
                            dup_of.get((h.source, h.key))) for h, sc, simf in hits])
    finally:
        w.close()
    return GapResult(sid, status, gap, per, failed)


def novelty(conn, search_id: str, card_vec, embedder) -> float | None:
    """참신성 = 1 − (카드 본문과 검색 결과 중 가장 가까운 항목의 cosine). 빈자리가 미측정이면 None."""
    r = conn.execute("SELECT status FROM supply_searches WHERE id=?", (search_id,)).fetchone()
    if r is None or r["status"] != "measured":
        return None
    snippets = [x[0] for x in conn.execute("SELECT snippet FROM supply_hits WHERE search_id=?", (search_id,))]
    if not snippets:
        return 1.0
    s = _sims(np.asarray(card_vec, dtype=np.float32), np.asarray(embedder.encode(snippets), dtype=np.float32))
    return round(1.0 - float(s.max()), 4)
