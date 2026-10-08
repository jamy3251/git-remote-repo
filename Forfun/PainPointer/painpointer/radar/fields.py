"""레이더 분야 6개(AI · 보안 · HCI · 통신 · IT 신기술 · 디지털트윈) — OpenAlex 토픽 집합으로 정의.

정의 규칙(definition_json에 그대로 저장, 바뀌면 radar_field_history에 이전 정의를 남긴다):
- AI = subfield 1702(Artificial Intelligence) + 1707(Computer Vision and Pattern Recognition)
- HCI = subfield 1709. 통신 = subfield 1705 + 전기전자(2208) 중 이름이 통신 계열인 토픽
- 보안 = 보안 키워드 검색 토픽 중 컴퓨터과학·공학 분야에서 이름이 보안 계열인 것
- 디지털트윈 = 최근 2년 'digital twin' 언급 논문이 몰린 토픽 중 그 토픽 논문의 5% 이상이 언급하는 것
  (OpenAlex에 디지털트윈 토픽이 따로 없다 — 2026-10-09 확인)
- IT 신기술(D4) = 위 5분야 토픽 중 L2 점유율 증가율 상위 10%(최근 12개월 학술지·학회 논문 200편 이상).
  L2 수치가 없으면 L4 신기술 목록(field='emerging') 항목과 이름이 가까운 토픽으로 대신하고 출처를 표시한다.
배정은 배타적이다: 한 토픽은 한 분야. 우선순위 IT 신기술 > 디지털트윈 > 보안 > HCI > 통신 > AI.

분야 배정 공통 규칙(토픽 없는 항목): 분야 토픽 '이름: 설명' 임베딩 평균(중심 벡터) 최근접, cosine이
FIELD_ASSIGN_MIN 미만이면 '분야 미정'(None). 묶음(D6): 같은 분야 커뮤니티 문장이 50% 이상이면 그 분야,
아니면 대표 문장에 중심 벡터 규칙.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

import numpy as np

from .. import config
from ..embed import EmbeddingMismatch
from . import radar_db
from .sources import SeriesPoint, shift_month, windows_12m
from .sources_l2 import PEER_VENUES, short_id

FIELD_ORDER = ("ai", "security", "hci", "telecom", "emerging", "digital_twin")
PRIORITY = ("emerging", "digital_twin", "security", "hci", "telecom", "ai")   # 겹치면 앞 분야
NAMES = {"ai": "AI", "security": "보안", "hci": "HCI", "telecom": "통신", "emerging": "IT 신기술",
         "digital_twin": "디지털트윈"}

DEFINITIONS = {
    "ai": {"subfields": ["1702", "1707"]},
    "hci": {"subfields": ["1709"]},
    "telecom": {"subfields": ["1705"], "search": ["wireless", "communication", "MIMO", "antenna", "5G", "satellite"],
                "search_subfields": ["2208"],
                "name_re": r"wireless|communicat|mimo|antenna|\b[56]g\b|millimeter|satellite|radio|optical network"},
    "security": {"search": ["security", "privacy", "cryptography", "intrusion", "malware", "authentication",
                            "adversarial attack", "vulnerability"],
                 "search_fields": ["17", "22"],
                 "name_re": r"secur|privacy|cryptograph|intrusion|malware|authenticat|adversarial|vulnerab|forensic"},
    "digital_twin": {"phrase": "digital twin", "years": 2, "top_k": 30},
    "emerging": {"l2": {"top_pct": None, "min_works": None}, "l4_list_field": "emerging"},
}
TOPIC_SELECT = "id,display_name,description,subfield,field,keywords"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _topic(t: dict) -> dict:
    return {"id": short_id(t["id"]), "name": t.get("display_name") or "", "description": t.get("description") or "",
            "subfield": short_id((t.get("subfield") or {}).get("id")), "field": short_id((t.get("field") or {}).get("id")),
            # OpenAlex가 준 순서 그대로(일반 용어가 앞). score순은 'abstract argumentation' 같은 전문 용어가 앞이라 HN 0건
            "keywords": [k.get("display_name") for k in t.get("keywords") or [] if isinstance(k, dict) and k.get("display_name")]}


@dataclass
class FieldSet:
    topics: dict[str, dict] = field(default_factory=dict)          # id → 토픽
    members: dict[str, set[str]] = field(default_factory=dict)     # 분야 → 토픽 id
    basis: dict[str, dict] = field(default_factory=dict)           # 분야 → 근거 수치
    emerging_source: str = ""
    counts: dict[str, tuple[int, int]] = field(default_factory=dict)   # 토픽 → (최근 12개월, 직전 12개월)


# ---- OpenAlex 조회(fetch는 원천 객체의 oa()를 쓴다: 키·재시도·모의 응답 공유) ----
class TopicFetcher:
    def __init__(self, oa_source):
        self.src = oa_source

    def subfield_topics(self, sf: str) -> list[dict]:
        out, page = [], 1
        while True:
            res = self.src.oa("topics", {"filter": f"subfield.id:{sf}", "per_page": 200, "page": page,
                                         "select": TOPIC_SELECT}).get("results") or []
            out += [_topic(t) for t in res]
            if len(res) < 200:
                return out
            page += 1

    def search_topics(self, kw: str) -> list[dict]:
        res = self.src.oa("topics", {"search": kw, "per_page": 50, "select": TOPIC_SELECT}).get("results") or []
        return [_topic(t) for t in res]

    def topics_by_id(self, ids: list[str]) -> list[dict]:
        out = []
        for i in range(0, len(ids), 50):
            res = self.src.oa("topics", {"filter": "ids.openalex:" + "|".join(ids[i:i + 50]), "per_page": 50,
                                         "select": TOPIC_SELECT}).get("results") or []
            out += [_topic(t) for t in res]
        return out

    def group_counts(self, flt: str, *, per_page: int = 200) -> dict[str, int]:
        data = self.src.oa("works", {"filter": flt, "group_by": "primary_topic.id", "per_page": per_page})
        return {short_id(g["key"]): int(g.get("count") or 0) for g in data.get("group_by") or []
                if g.get("key") and "unknown" not in str(g["key"])}

    def topic_counts(self, ids: list[str], a: str, b: str, *, peer: bool = True) -> dict[str, int]:
        """토픽별 논문 수. peer=True면 학술지·학회 논문만(L2 증가율 — 저장소 항목 급증 제외)."""
        out: dict[str, int] = {}
        for i in range(0, len(ids), 100):
            out.update(self.group_counts(f"primary_topic.id:{'|'.join(ids[i:i + 100])},"
                                         f"from_publication_date:{a},to_publication_date:{b}"
                                         + (f",{PEER_VENUES}" if peer else "")))
        return out


def collect_candidates(f: TopicFetcher, today: date) -> FieldSet:
    """분야별 후보 토픽(배타 배정 전)."""
    fs = FieldSet()
    for fid in ("ai", "hci", "telecom", "security", "digital_twin"):
        d = DEFINITIONS[fid]
        got: dict[str, dict] = {}
        for sf in d.get("subfields", []):
            got.update({t["id"]: t for t in f.subfield_topics(sf)})
        if d.get("search"):
            rx = re.compile(d["name_re"], re.IGNORECASE)
            for kw in d["search"]:
                for t in f.search_topics(kw):
                    ok_place = (t["subfield"] in d.get("search_subfields", []) or t["field"] in d.get("search_fields", [])
                                or t["subfield"] in d.get("subfields", []))
                    if ok_place and rx.search(t["name"]):
                        got[t["id"]] = t
        if fid == "digital_twin":
            got, fs.basis[fid] = digital_twin_topics(f, today, d)
        fs.members[fid] = set(got)
        fs.topics.update(got)
    return fs


def digital_twin_topics(f: TopicFetcher, today: date, d: dict) -> tuple[dict[str, dict], dict]:
    a = f"{today.year - d['years']:04d}-{today.month:02d}-01"
    b = today.isoformat()
    dt = f.group_counts(f'title_and_abstract.search:"{d["phrase"]}",from_publication_date:{a},to_publication_date:{b}',
                        per_page=d["top_k"])
    top = sorted(dt, key=lambda k: -dt[k])[:d["top_k"]]
    total = f.topic_counts(top, a, b, peer=False)       # 분자(언급 논문)와 같은 범위로
    share = {k: dt[k] / total[k] for k in top if total.get(k)}
    keep = [k for k in top if share.get(k, 0) >= config.DIGITAL_TWIN_MIN_SHARE]
    topics = {t["id"]: t for t in f.topics_by_id(keep)}
    basis = {"window": [a, b], "min_share": config.DIGITAL_TWIN_MIN_SHARE,
             "share": {k: round(share[k], 4) for k in keep}, "n_candidates": len(top)}
    return topics, basis


def exclusive(members: dict[str, set[str]]) -> dict[str, set[str]]:
    """우선순위대로 한 토픽은 한 분야에만."""
    taken: set[str] = set()
    out = {}
    for fid in PRIORITY:
        out[fid] = set(members.get(fid, set())) - taken
        taken |= out[fid]
    return out


# ---- IT 신기술(D4) ----
def emerging_from_l2(counts: dict[str, tuple[int, int]], base: dict[str, set[str]], *,
                     top_pct: float | None = None, min_works: int | None = None) -> tuple[set[str], dict]:
    """5분야 토픽의 분야 내 점유율 증가율(최근 12개월 점유율 / 직전 12개월 점유율) 상위 top_pct."""
    top_pct = config.EMERGING_TOP_PCT if top_pct is None else top_pct
    min_works = config.EMERGING_MIN_WORKS if min_works is None else min_works
    growth: dict[str, float] = {}
    for fid, ids in base.items():
        cur_tot = sum(counts.get(t, (0, 0))[0] for t in ids)
        prev_tot = sum(counts.get(t, (0, 0))[1] for t in ids)
        if not cur_tot or not prev_tot:
            continue
        for t in ids:
            cur, prev = counts.get(t, (0, 0))
            if cur >= min_works and prev > 0:
                growth[t] = (cur / cur_tot) / (prev / prev_tot)
    k = math.ceil(len(growth) * top_pct) if growth else 0
    picked = sorted(growth, key=lambda t: -growth[t])[:k]
    cut = growth[picked[-1]] if picked else None
    return set(picked), {"rule": f"L2 점유율 증가율 상위 {top_pct:.0%}", "min_works": min_works,
                         "n_candidates": len(growth), "cutoff_growth": cut and round(cut, 4),
                         "growth": {t: round(growth[t], 4) for t in picked}}


def emerging_from_l4(conn, topics: dict[str, dict], base_ids: set[str], embedder, *,
                     threshold: float | None = None) -> tuple[set[str], dict]:
    """L4 신기술 목록(현행 판) 항목과 이름이 가까운 5분야 토픽. L2 수치가 오기 전의 임시 정의."""
    threshold = config.EMERGING_MATCH_MIN if threshold is None else threshold
    entries = []
    for r in conn.execute("SELECT id, title, metrics_json FROM signal_items WHERE layer=4 AND kind='list_entry'"):
        m = json.loads(r["metrics_json"] or "{}")
        if m.get("field") == DEFINITIONS["emerging"]["l4_list_field"] and m.get("current"):
            entries.append((r["id"], r["title"], f"{m.get('list_id')} {m.get('edition')}"))
    ids = sorted(base_ids)
    if not entries or not ids:
        return set(), {"rule": "L4 신기술 목록 언급", "lists": [], "matches": {}}
    E = embedder.encode([e[1] for e in entries])
    T = embedder.encode([topic_text(topics[t]) for t in ids])
    sims = T @ E.T
    picked, matches = set(), {}
    for i, t in enumerate(ids):
        j = int(np.argmax(sims[i]))
        if sims[i, j] >= threshold:
            picked.add(t)
            matches[t] = {"entry": entries[j][0], "title": entries[j][1], "cos": round(float(sims[i, j]), 4)}
    return picked, {"rule": f"L4 신기술 목록 언급(cosine ≥ {threshold})", "lists": sorted({e[2] for e in entries}),
                    "matches": matches}


def topic_text(t: dict) -> str:
    return f"{t['name']}: {t.get('description', '')}".strip()


def l2_counts(f: TopicFetcher, ids: list[str], today: date) -> dict[str, tuple[int, int]]:
    (c0, c1), (p0, p1), _ = windows_12m(today)
    cur = f.topic_counts(ids, c0, c1)
    prev = f.topic_counts(ids, p0, p1)
    return {t: (cur.get(t, 0), prev.get(t, 0)) for t in ids}


# ---- 저장 ----
def centroid(embedder, topics: list[dict]) -> np.ndarray | None:
    if not topics:
        return None
    V = embedder.encode([topic_text(t) for t in topics])
    c = V.mean(axis=0)
    n = np.linalg.norm(c)
    return (c / n).astype(np.float32) if n else None


def save_fields(conn, fs: FieldSet, final: dict[str, set[str]], embedder, today: date) -> dict:
    """radar_fields·topics·이력·L2 시계열 저장. 반환 {분야: 토픽 수}."""
    now = _now()
    summary = {}
    with conn:
        for fid in FIELD_ORDER:
            ids = sorted(final.get(fid, set()))
            definition = {"rule": DEFINITIONS[fid], "basis": fs.basis.get(fid, {}), "built": today.isoformat()}
            src = fs.emerging_source if fid == "emerging" else "openalex"
            c = centroid(embedder, [fs.topics[t] for t in ids])
            prev = conn.execute("SELECT definition_json FROM radar_fields WHERE id=?", (fid,)).fetchone()
            prev_ids = sorted(r[0] for r in conn.execute("SELECT id FROM topics WHERE field_id=?", (fid,)))
            if prev is not None and prev_ids != ids:
                conn.execute("INSERT INTO radar_field_history(field_id, definition_json, topic_ids_json, definition_source,"
                             " changed_at) SELECT id, definition_json, ?, definition_source, ? FROM radar_fields WHERE id=?",
                             (json.dumps(prev_ids), now, fid))
            conn.execute(
                "INSERT INTO radar_fields(id, name, description, centroid, centroid_model, definition_source, updated_at,"
                " definition_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,"
                " description=excluded.description, centroid=excluded.centroid, centroid_model=excluded.centroid_model,"
                " definition_source=excluded.definition_source, updated_at=excluded.updated_at,"
                " definition_json=excluded.definition_json",
                (fid, NAMES[fid], f"OpenAlex 토픽 {len(ids)}개", c.tobytes() if c is not None else None,
                 embedder.model_name if c is not None else None, src, now,
                 json.dumps(definition, ensure_ascii=False, default=sorted)))
            summary[fid] = len(ids)
        conn.execute("UPDATE topics SET field_id=NULL")
        for fid, ids in final.items():
            for t in ids:
                tp = fs.topics[t]
                conn.execute("INSERT INTO topics(id, name, description, field_id, updated_at, keywords_json) VALUES (?,?,?,?,?,?)"
                             " ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,"
                             " field_id=excluded.field_id, updated_at=excluded.updated_at, keywords_json=excluded.keywords_json",
                             (t, tp["name"], tp["description"], fid, now,
                              json.dumps(tp.get("keywords") or [], ensure_ascii=False)))
        if fs.counts:
            pts = []
            (_, _), (_, _), end = windows_12m(today)
            for fid, ids in final.items():
                cur_tot = sum(fs.counts.get(t, (0, 0))[0] for t in ids)
                prev_tot = sum(fs.counts.get(t, (0, 0))[1] for t in ids)
                for t in ids:
                    cur, prev = fs.counts.get(t, (0, 0))
                    if cur_tot:
                        pts.append(SeriesPoint(t, 2, "works_12m", end, cur, cur_tot, "total"))
                    if prev_tot:
                        pts.append(SeriesPoint(t, 2, "works_12m", shift_month(end, -12), prev, prev_tot, "total"))
            conn.executemany("INSERT OR REPLACE INTO topic_series(topic_id, layer, metric, period, value, denom, denom_kind,"
                             " snapshot_date) VALUES (?,?,?,?,?,?,?,?)",
                             [(p.topic_id, p.layer, p.metric, p.period, p.value, p.denom, p.denom_kind, today.isoformat())
                              for p in pts])
    return summary


def build_fields(oa_source, embedder, *, radar_path=None, use_l2: bool = True, progress=None) -> dict:
    """OpenAlex에서 분야 토픽을 모아 배타 배정 → IT 신기술 → 저장. 반환 {분야: 토픽 수, '_emerging_source': ...}."""
    say = progress or (lambda *_: None)
    today = oa_source.today
    f = TopicFetcher(oa_source)
    fs = collect_candidates(f, today)
    base = exclusive({k: v for k, v in fs.members.items() if k != "emerging"})
    say("후보 토픽: " + ", ".join(f"{NAMES[k]} {len(v)}" for k, v in base.items()))
    base_ids = set().union(*base.values())
    radar_db.init_radar_db(radar_path)
    conn = radar_db.open_write(radar_path)
    try:
        emerging, basis = set(), {}
        if use_l2:
            try:
                fs.counts = l2_counts(f, sorted(base_ids), today)
                emerging, basis = emerging_from_l2(fs.counts, base)
                fs.emerging_source = f"L2: OpenAlex 최근 12개월 점유율 증가율 상위 {config.EMERGING_TOP_PCT:.0%}"
            except Exception as e:  # noqa: BLE001 — L2 조회 실패 시 L4 대체 정의
                say(f"L2 수치 조회 실패 → L4 신기술 목록으로 대체: {type(e).__name__}: {e}")
                fs.counts = {}
        if not fs.emerging_source:
            emerging, basis = emerging_from_l4(conn, fs.topics, base_ids, embedder)
            fs.emerging_source = "L4: " + (", ".join(basis["lists"]) or "신기술 목록 없음") + " 언급 토픽(L2 적재 전 임시)"
        fs.basis["emerging"] = basis
        final = exclusive({**base, "emerging": emerging})
        summary = save_fields(conn, fs, final, embedder, today)
    finally:
        conn.close()
    say("분야: " + ", ".join(f"{NAMES[k]} {v}" for k, v in summary.items()) + f" · IT 신기술 정의 = {fs.emerging_source}")
    return {**summary, "_emerging_source": fs.emerging_source}


# ---- 분야 배정 공통 규칙 ----
def load_centroids(conn, model: str) -> dict[str, np.ndarray]:
    out = {}
    for r in conn.execute("SELECT id, centroid, centroid_model FROM radar_fields WHERE centroid IS NOT NULL"):
        if r["centroid_model"] != model:
            raise EmbeddingMismatch(f"재계산 필요: 분야 중심 벡터 모델 {r['centroid_model']} ≠ {model}. "
                                    "python -m painpointer radar-fields build 로 다시 만드세요.")
        out[r["id"]] = np.frombuffer(r["centroid"], dtype=np.float32)
    return out


def assign_field(conn, vec, model: str, *, threshold: float | None = None) -> tuple[str | None, float]:
    """중심 벡터 최근접 분야와 cosine. 임계 미만이면 (None, cosine) = 분야 미정."""
    threshold = config.FIELD_ASSIGN_MIN if threshold is None else threshold
    cents = load_centroids(conn, model)
    if not cents:
        return None, 0.0
    q = np.asarray(vec, dtype=np.float32)
    q = q / (np.linalg.norm(q) or 1)
    best = max(cents, key=lambda k: float(cents[k] @ q))
    score = float(cents[best] @ q)
    return (best if score >= threshold else None), round(score, 4)


def bundle_field(conn, sources: list[tuple[str, str]], rep_vec, model: str, *,
                 threshold: float | None = None) -> tuple[str | None, str]:
    """D6: 묶음 문장 출처(source, board) 목록 중 같은 분야 커뮤니티가 50% 이상이면 그 분야, 아니면 대표 문장
    중심 벡터 규칙. 반환 (분야 또는 None, 근거 'community'|'centroid')."""
    comm = {(r["source"], r["board"]): r["field_id"] for r in conn.execute("SELECT * FROM community_fields")}
    votes = Counter(comm[s] for s in sources if s in comm)
    if votes and sources:
        fid, n = votes.most_common(1)[0]
        if n * 2 >= len(sources):
            return fid, "community"
    return assign_field(conn, rep_vec, model, threshold=threshold)[0], "centroid"


# ---- 토픽 원천 질의 ----
ARXIV_DENOM = {"ai": "cat:cs.AI OR cat:cs.LG OR cat:cs.CV OR cat:cs.CL", "security": "cat:cs.CR",
               "hci": "cat:cs.HC", "telecom": "cat:cs.NI OR cat:eess.SP OR cat:cs.IT",
               "digital_twin": "cat:eess.SY OR cat:cs.SY OR cat:cs.RO", "emerging": "cat:cs.*"}
TOPIC_SOURCES = ("openalex", "semantic_scholar", "arxiv", "gdelt", "hackernews")


def public_terms(name: str, keywords: list[str], n: int = 2) -> list[str]:
    """대중 원천(HN·GDELT·S2) 검색어. 토픽 이름은 학술 이름이라('Semantic Web and Ontologies') HN에서 0건이 나온다 —
    OpenAlex 키워드 중 두 단어 이상인 것을 점수순으로 n개 쓴다('semantic web' 189건, 2026-10-09 실측).
    한 단어 약어('RDF')는 HN 검색이 부분 일치로 부풀려(6,408건) 쓰지 않는다. 키워드가 없으면 토픽 이름."""
    picked = []
    for k in keywords or []:
        k = " ".join(str(k).split())
        if len(k.split()) >= 2 and "(" not in k and k.lower() not in {p.lower() for p in picked}:
            picked.append(k)
        if len(picked) >= n:
            break
    return picked or [name]


def topic_queries(conn, field_id: str, sources: tuple[str, ...] = TOPIC_SOURCES, limit: int | None = None) -> list[tuple[str, dict]]:
    """분야 토픽마다 토픽 원천 질의. 학계 원천(OpenAlex·arXiv)은 토픽 이름, 대중 원천은 public_terms."""
    topics = [dict(r) for r in conn.execute("SELECT id, name, keywords_json FROM topics WHERE field_id=? ORDER BY id",
                                            (field_id,))]
    if limit:
        topics = topics[:limit]
    ids = [r[0] for r in conn.execute("SELECT id FROM topics WHERE field_id=? ORDER BY id", (field_id,))]
    field_filter = [f"primary_topic.id:{'|'.join(ids[i:i + 100])}" for i in range(0, len(ids), 100)]
    venues = [r[0] for r in conn.execute("SELECT source_id FROM prestige_venues WHERE radar_field_id=?", (field_id,))]
    out = []
    for t in topics:
        name = t["name"]
        terms = public_terms(name, json.loads(t["keywords_json"] or "[]"))
        gdelt = " OR ".join(f'"{x}"' for x in terms)
        q = {"openalex": {"topic_id": t["id"], "field_filter": field_filter, "venues": venues, "top": 20},
             "semantic_scholar": {"topic_id": t["id"], "terms": terms[0]},
             "arxiv": {"topic_id": t["id"], "search": f'all:"{name}"', "denom_search": ARXIV_DENOM[field_id]},
             "gdelt": {"topic_id": t["id"], "query": f"({gdelt})" if len(terms) > 1 else gdelt},
             "hackernews": {"topic_id": t["id"], "query": terms[0], "top": 5}}
        out += [(s, q[s]) for s in sources if s in q]
    return out


def venue_query(conn, field_id: str) -> dict | None:
    """분야 명망지 질의(openalex_venues). subfield로 정의된 분야는 subfield 필터, 나머지는 토픽 id(최대 100개)."""
    sfs = DEFINITIONS[field_id].get("subfields")
    if sfs and field_id not in ("telecom",):
        flt = "primary_topic.subfield.id:" + "|".join(sfs)
    else:
        ids = [r[0] for r in conn.execute("SELECT id FROM topics WHERE field_id=? ORDER BY id", (field_id,))][:100]
        if not ids:
            return None
        flt = "primary_topic.id:" + "|".join(ids)
    return {"radar_field_id": field_id, "filter": flt}
