"""페인 지도(발견 모드): 페인을 모를 때, 고른 커뮤니티의 최근 글에서 반복되는 불편을 찾아 순위로 보여준다.

흐름: 보드별 최근 글 → 중복 제거 → 층화 표본(≤800) → 글별 불편 한 문장 추출(LLM, 글 단위 캐시)
→ 불편 문장 임베딩 군집(파이썬) → 묶음별 수치(파이썬) → 원문 대조 인용 → 단일 HTML.

- 묶음 이름은 LLM이 짓지 않는다. 묶음 중심에 가장 가까운 실제 추출 문장을 그대로 쓴다(지어낸 요약 없음).
- 원칙: 지도는 질문(가설 후보)만 만들고, 답(근거 수치)은 검증 리포트만 낸다(2026-10-04).
  그래서 지도에는 비율·막대가 없고 건수는 "후보 신호"로만 표기한다. 지도 수치는 근거로 인용하지 않는다.
  추출은 관련성 판정 없이 느슨하게 하고 분모에 공지·잡담이 섞이므로 리포트 수치와 의미가 다르다.
- 검증 리포트에는 지도의 수치를 싣지 않는다(다른 가설 후보 문장 + 검증 링크만).
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from dccrawler.models import Post, parse_day
from dccrawler.storage import Store

from . import config, db
from .aggregate import cluster_stats, month_of
from .classify import BODY_MAX_CHARS, _INJECTION_RE, _post_block, stratified_sample
from .cluster import _labels
from .llm import LLM, LLMError, estimate_tokens, load_prompt, price_of
from .log import log_event
from .search import dedup
from .textnorm import clip_quote, mask_author, prompt_hash, text_hash, verify_quote

_ITEM = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "pain": {"type": "string", "maxLength": 60},
        "intensity": {"type": "integer", "minimum": 0, "maximum": 3},
        "quote": {"type": "string"},
        "inj": {"type": "boolean"},
    },
    "required": ["id", "pain", "intensity", "quote", "inj"],
    "additionalProperties": False,
}
EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {"extracts": {"type": "array", "items": _ITEM}},
    "required": ["extracts"],
    "additionalProperties": False,
}
OUT_TOKENS_PER_POST = 80
PAIN_MAX_CHARS = 60
QUOTES_PER_ITEM = 3


@dataclass
class DiscoverRequest:
    boards: list[str]                  # "source:board"
    target: str = ""
    days: int = config.DISCOVER_DAYS


@dataclass
class Extract:
    post_key: str
    pain: str
    intensity: int
    quote: str
    injection: bool = False
    status: str = "ok"
    cached: bool = False


@dataclass
class MapQuote:
    text: str
    source: str
    board: str
    created_at: str
    author_masked: str | None
    url: str | None
    intensity: int


@dataclass
class PainItem:
    rank: int
    pain: str                          # 묶음 중심에 가장 가까운 실제 추출 문장
    variants: list[str]                # 같은 묶음의 다른 표현(최대 4)
    n_posts: int
    intensity_counts: dict[str, int]
    unique_authors_strong: int | None
    distinct_ip_bands_weak: int | None
    months_present: int
    boards: list[str]
    quotes: list[MapQuote]
    weak: bool


@dataclass
class PainMap:
    id: str
    boards: list[str]
    target: str
    since: str
    n_collected: int
    n_dedup: int
    n_sample: int
    sampled: bool
    n_failed: int
    n_with_pain: int
    n_grouped: int
    n_other: int
    n_injection: int
    items: list[PainItem]
    model: str
    prompt_hash: str
    n_calls: int
    created_at: str
    degraded: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def parse_boards(boards: list[str]) -> list[tuple[str, str]]:
    out = []
    for b in boards:
        src, _, board = b.partition(":")
        if not src or not board:
            raise ValueError(f"보드는 source:board 형식이어야 합니다: {b}")
        out.append((src.strip(), board.strip()))
    return out


def load_window(store: Store, boards: list[tuple[str, str]], since: str) -> list[Post]:
    posts: list[Post] = []
    for src, board in boards:
        for p in store.load_posts(src, board):
            d = parse_day(p.created_at, p.crawled_at)
            if d is not None and d >= since:
                posts.append(p)
    return posts


# ---- 추출(캐시) ----
def _load_cache(conn: sqlite3.Connection, keys: list[str], ph: str, model: str) -> dict[str, Extract]:
    out: dict[str, Extract] = {}
    for i in range(0, len(keys), 400):
        chunk = keys[i:i + 400]
        for r in conn.execute(
            "SELECT * FROM pain_extracts WHERE prompt_hash=? AND model=? AND status='ok' AND post_key IN (%s)"
            % ",".join("?" * len(chunk)), [ph, model, *chunk]):
            out[r["post_key"]] = Extract(post_key=r["post_key"], pain=r["pain"].rstrip(" ."), intensity=int(r["intensity"]),
                                         quote=r["quote"], injection=bool(r["injection_flag"]), cached=True)
    return out


def _save(conn: sqlite3.Connection, rows: list[Extract], ph: str, model: str) -> None:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with conn:
        conn.executemany(
            "INSERT INTO pain_extracts(post_key, prompt_hash, model, pain, intensity, quote, injection_flag, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(post_key, prompt_hash, model) DO UPDATE SET"
            " pain=excluded.pain, intensity=excluded.intensity, quote=excluded.quote,"
            " injection_flag=excluded.injection_flag, status=excluded.status, created_at=excluded.created_at",
            [(e.post_key, ph, model, e.pain, e.intensity, e.quote, int(e.injection), e.status, now) for e in rows],
        )


def _post_process(raw: dict, p: Post) -> Extract:
    pain = " ".join(str(raw.get("pain") or "").split())[:PAIN_MAX_CHARS].rstrip(" .")
    try:
        intensity = max(0, min(3, int(raw.get("intensity", 0))))
    except (TypeError, ValueError):
        intensity = 0
    if not pain:
        intensity = 0
    elif intensity == 0:
        intensity = 1
    injection = bool(raw.get("inj")) or bool(_INJECTION_RE.search(p.index_text()))
    quote = clip_quote(str(raw.get("quote") or ""), config.QUOTE_MAX_CHARS)
    if injection or not quote or not verify_quote(quote, p.index_text()):
        quote = ""                      # 원문에 글자 그대로 없거나 인젝션 의심이면 인용 버림(불편 문장은 유지)
    return Extract(post_key=p.key, pain=pain, intensity=intensity, quote=quote, injection=injection)


def extract(sample: list[Post], llm: LLM, *, db_path: str | Path, model: str | None = None,
            batch_size: int | None = None, concurrency: int = config.LLM_CONCURRENCY,
            job_id: str | None = None, progress=None) -> tuple[list[Extract], int, str]:
    """반환 (추출 목록, 호출 수, prompt_hash). 실패 글은 status='failed'로 돌려주고 캐시하지 않는다."""
    model = model or config.MODEL_CLASSIFY
    batch_size = max(1, batch_size or config.CLASSIFY_BATCH)
    system = load_prompt("discover")
    ph = prompt_hash(system)
    conn = db.open_read(db_path)
    try:
        cache = _load_cache(conn, [p.key for p in sample], ph, model)
    finally:
        conn.close()
    todo = [p for p in sample if p.key not in cache]
    batches = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    if batches:
        llm.check_daily_limit(len(batches))
        pin, pout = price_of(model)
        est_in = sum(estimate_tokens(system + "\n".join(_post_block(i + 1, p) for i, p in enumerate(b))) for b in batches)
        est_out = sum(OUT_TOKENS_PER_POST * len(b) + 60 for b in batches)
        llm.check_budget((est_in * pin + est_out * pout) / 1_000_000)

    def work(batch: list[Post]) -> list[Extract]:
        user = "\n".join(_post_block(i + 1, p) for i, p in enumerate(batch))
        try:
            raw = llm.call("discover", model, system, user, schema=EXTRACT_SCHEMA, prompt_hash=ph,
                           max_tokens=OUT_TOKENS_PER_POST * len(batch) + 60, retries=3, job_id=job_id,
                           required=("extracts",))
        except LLMError:
            return [Extract(post_key=p.key, pain="", intensity=0, quote="", status="failed") for p in batch]
        by_id: dict[str, dict] = {}
        for item in raw.get("extracts") or []:
            if isinstance(item, dict):
                by_id.setdefault(str(item.get("id", "")).strip(), item)
        out = []
        for i, p in enumerate(batch):
            item = by_id.get(str(i + 1))
            out.append(_post_process(item, p) if item is not None
                       else Extract(post_key=p.key, pain="", intensity=0, quote="", status="failed"))
        return out

    new: list[Extract] = []
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        for items in ex.map(work, batches):
            new.extend(items)
            if progress and (len(new) % 50 < len(items) or len(new) == len(todo)):
                progress(f"불편 추출 {len(new)}/{len(todo)} (캐시 {len(cache)})")
    ok = [e for e in new if e.status == "ok"]
    if ok:
        wconn = db.open_write(db_path)
        try:
            _save(wconn, ok, ph, model)
        finally:
            wconn.close()
    by_key = {**cache, **{e.post_key: e for e in new}}
    return [by_key[p.key] for p in sample if p.key in by_key], len(batches), ph


# ---- 묶기·수치 ----
def group_pains(rows: list[tuple[Post, Extract]], vectors: np.ndarray, *, n_sample: int,
                months_set: set[str] | None = None) -> tuple[list[PainItem], int]:
    """불편 문장 벡터로 군집 → PainItem 목록(건수 내림차순)과 '기타' 건수."""
    if not rows:
        return [], 0
    labels = _labels(vectors, config.DISCOVER_CLUSTER)
    groups: dict[int, list[int]] = {}
    for i, l in enumerate(labels):
        groups.setdefault(int(l), []).append(i)
    items: list[PainItem] = []
    other = 0
    for idx in groups.values():
        if len(idx) < config.DISCOVER_MIN_SIZE:
            other += len(idx)
            continue
        X = vectors[idx]
        c = X.mean(axis=0)
        sims = X @ c / (np.linalg.norm(X, axis=1) * (np.linalg.norm(c) or 1) + 1e-9)
        ranked = np.argsort(-sims)
        # 이름: 중심에 가장 가까운 문장들(최고 유사도 −0.05 이내, 상위 5) 중 가장 짧은 실제 문장
        near = [int(j) for j in ranked[:5] if sims[int(j)] >= sims[int(ranked[0])] - 0.05]
        head = min(near, key=lambda j: (len(rows[idx[j]][1].pain), j))
        order = [idx[head]] + [idx[int(j)] for j in ranked if int(j) != head]
        members = [rows[i] for i in order]
        posts = [p for p, _ in members]
        st = cluster_stats(posts, months_set)
        seen_v: set[str] = set()
        variants = []
        for _, e in members[1:]:
            if e.pain not in seen_v and e.pain != members[0][1].pain:
                seen_v.add(e.pain)
                variants.append(e.pain)
            if len(variants) >= 4:
                break
        items.append(PainItem(
            rank=0, pain=members[0][1].pain, variants=variants, n_posts=len(members),
            intensity_counts={str(k): v for k, v in sorted(Counter(e.intensity for _, e in members).items())},
            unique_authors_strong=st["unique_authors_strong"], distinct_ip_bands_weak=st["distinct_ip_bands_weak"],
            months_present=st["months_present"], boards=sorted({f"{p.source}:{p.board}" for p in posts}),
            quotes=_pick_quotes(members), weak=len(members) < config.DISCOVER_WEAK,
        ))
    items.sort(key=lambda it: (-it.n_posts, -(it.unique_authors_strong or 0), -(it.distinct_ip_bands_weak or 0), it.pain))
    for i, it in enumerate(items, 1):
        it.rank = i
    return items, other


def _pick_quotes(members: list[tuple[Post, Extract]]) -> list[MapQuote]:
    """강도 높은 순, 같은 작성자 1건, 원문 대조 통과한 인용만."""
    out: list[MapQuote] = []
    authors: set[tuple] = set()
    for p, e in sorted(members, key=lambda m: (-m[1].intensity, m[0].created_at or "", m[0].key)):
        if not e.quote:
            continue
        akey = (p.author_id_kind, p.author_id) if p.author_id and p.author_id_kind != "none" else None
        if akey and akey in authors:
            continue
        if akey:
            authors.add(akey)
        out.append(MapQuote(text=e.quote, source=p.source, board=p.board,
                            created_at=(p.created_at or "")[:10], author_masked=mask_author(p.author),
                            url=p.url, intensity=e.intensity))
        if len(out) >= QUOTES_PER_ITEM:
            break
    return out


# ---- 오케스트레이터 ----
def discover(req: DiscoverRequest, *, db_path: str | Path | None = None, llm: LLM, embedder,
             today: date | None = None, job_id: str | None = None, progress=None) -> tuple[PainMap, str]:
    from .aggregate import window_months
    from .render import render_page
    db_path = Path(db_path or config.DB_PATH)
    today = today or date.today()
    say = progress or (lambda *_: None)
    boards = parse_boards(req.boards)
    since = (today - timedelta(days=req.days)).isoformat()
    store = Store(db_path, readonly=True)
    try:
        raw = load_window(store, boards, since)
    finally:
        store.close()
    dd = dedup(raw)
    seed = text_hash("|".join(sorted(req.boards)) + since)
    sample, sampled = stratified_sample(dd.posts, config.SAMPLE_MAX, seed=seed)
    say(f"수집 {len(raw)}건 → 중복 제거 {len(dd.posts)}건 → 판정 표본 {len(sample)}건{' (층화 표본)' if sampled else ' (전수)'}")
    extracts, n_calls, ph = extract(sample, llm, db_path=db_path, job_id=job_id, progress=say)
    by_key = {p.key: p for p in sample}
    with_pain = [(by_key[e.post_key], e) for e in extracts if e.status == "ok" and e.pain and e.intensity >= 1]
    n_failed = sum(1 for e in extracts if e.status != "ok")
    say(f"불편이 있는 글 {len(with_pain)}건 / 표본 {len(sample)}건")
    degraded: list[str] = []
    if with_pain:
        vectors = embedder.encode([e.pain for _, e in with_pain])
        items, other = group_pains(with_pain, vectors, n_sample=len(sample),
                                   months_set=set(window_months(today)))
    else:
        items, other = [], 0
    if n_failed:
        degraded.append(f"추출 실패 {n_failed}건(분자·분모 어느 쪽에도 넣지 않음)")
    pm = PainMap(
        id=secrets.token_urlsafe(12), boards=list(req.boards), target=req.target.strip(), since=since,
        n_collected=len(raw), n_dedup=len(dd.posts), n_sample=len(sample), sampled=sampled, n_failed=n_failed,
        n_with_pain=len(with_pain), n_grouped=sum(it.n_posts for it in items), n_other=other,
        n_injection=sum(1 for e in extracts if e.injection), items=items, model=config.MODEL_CLASSIFY,
        prompt_hash=ph, n_calls=n_calls, created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        degraded=degraded,
    )
    say(f"반복 불편 {len(items)}개 묶음 (묶인 글 {pm.n_grouped}건, 기타 {other}건)")
    html = render_page("painmap.html", pm=pm, sources=sorted({b.split(':')[0] for b in req.boards}),
                       min_size=config.DISCOVER_MIN_SIZE, weak=config.DISCOVER_WEAK)
    wconn = db.open_write(db_path)
    try:
        with wconn:
            wconn.execute("INSERT INTO pain_maps(id, boards_json, target, since, map_json, html, created_at) VALUES (?,?,?,?,?,?,?)",
                          (pm.id, json.dumps(pm.boards, ensure_ascii=False), pm.target, since,
                           json.dumps(pm.to_dict(), ensure_ascii=False), html, pm.created_at))
    finally:
        wconn.close()
    log_event("painmap", job_id=job_id, map_id=pm.id, boards=pm.boards, n_sample=pm.n_sample,
              n_with_pain=pm.n_with_pain, n_items=len(items))
    return pm, html


def load_map_html(db_path: str | Path, map_id: str) -> str | None:
    conn = db.open_read(db_path)
    try:
        r = conn.execute("SELECT html FROM pain_maps WHERE id=?", (map_id,)).fetchone()
        return r["html"] if r else None
    finally:
        conn.close()


def adjacent_pains(conn: sqlite3.Connection, sources: list[str], *, exclude_pain: str = "",
                   max_age_days: int = 30, limit: int = 5, today: date | None = None) -> dict | None:
    """검증 리포트가 근거 부족일 때 보여줄 '같은 소스에서 더 많이 나온 불편'. 최근 지도 1개에서 가져온다."""
    today = today or date.today()
    try:
        rows = conn.execute("SELECT id, boards_json, map_json, created_at FROM pain_maps ORDER BY created_at DESC LIMIT 20").fetchall()
    except sqlite3.OperationalError:
        return None
    want = set(sources or [])
    for r in rows:
        if (today - date.fromisoformat(r["created_at"][:10])).days > max_age_days:
            break
        boards = json.loads(r["boards_json"])
        if want and not want & {b.split(":")[0] for b in boards}:
            continue
        m = json.loads(r["map_json"])
        items = [it for it in m["items"] if it["pain"] != exclude_pain and not it["weak"]][:limit]
        if not items:
            continue
        # 지도 수치는 넘기지 않는다: 리포트(근거)에 후보 신호 건수가 섞이지 않게
        return {"map_id": r["id"], "boards": boards, "created_at": r["created_at"],
                "pains": [it["pain"] for it in items]}
    return None
