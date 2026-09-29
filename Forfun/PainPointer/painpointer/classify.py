"""3단계 classify: 층화 표본 → 4중키 캐시 → LLM 판정(글 N건 묶음, 동시성 8, 재시도 3) → 인용 원문 대조.

토큰 효율:
- 글 CLASSIFY_BATCH건을 한 호출에 묶어 시스템 프롬프트를 상각한다(호출당 <post id="k"> 블록 N개).
- 본문은 BODY_MAX_CHARS(900자)까지만 보낸다. 출력은 id/relevant/intensity/quotes/inj 다섯 키만(설명 없음).
- 캐시 키는 여전히 글 단위 (post_key, pain_hash, prompt_hash, model). 묶음 응답에 빠진 id는 그 글만 F.

- 표본(S): N ≤ 800 전수, N > 800이면 월별·소스별 적중 수 비례(최대잔여법) 층화 무작위 800건. 시드 = Random(query_hash).
- 판정 불가(F): 재시도 후 실패, 응답에 id 누락, 또는 relevant=true & intensity=0(판정 오류).
- 인용: 정규화 후 원문 스냅샷의 완전 부분문자열이어야 verified. 120자 초과는 잘라서 재대조.
- injection_flag: LLM 의심 표시 또는 휴리스틱 적중 → 판정은 유지하되 인용은 전부 제외.
"""
from __future__ import annotations

import json
import random
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from dccrawler.models import Post

from . import config, db
from .aggregate import month_of
from .llm import LLM, LLMError, estimate_tokens, load_prompt, price_of
from .models import Judgment, QuoteCandidate
from .textnorm import clip_quote, excerpt_context, prompt_hash, verify_quote

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "relevant": {"type": "boolean"},
        "intensity": {"type": "integer", "minimum": 0, "maximum": 3},
        "quotes": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
        "inj": {"type": "boolean"},
    },
    "required": ["id", "relevant", "intensity", "quotes", "inj"],
    "additionalProperties": False,
}
JUDGMENT_SCHEMA = {
    "type": "object",
    "properties": {"judgments": {"type": "array", "items": _ITEM_SCHEMA}},
    "required": ["judgments"],
    "additionalProperties": False,
}

_INJECTION_RE = re.compile(
    r"(이전\s*지시|위의?\s*지시|시스템\s*프롬프트|프롬프트를?\s*무시|지시를?\s*무시|무시하고\s*(관련|답)|"
    r"관련\s*있다고\s*(답|출력|판정)|relevant\s*[:=]\s*true|ignore\s+(all\s+)?(previous|prior|above)\s+instructions|"
    r"system\s+prompt|you\s+are\s+now|as\s+an\s+ai\b|assistant\s*:)",
    re.IGNORECASE,
)
BODY_MAX_CHARS = 900
OUT_TOKENS_PER_POST = 90


def stratified_sample(posts: list[Post], max_n: int = config.SAMPLE_MAX, seed: str = "") -> tuple[list[Post], bool]:
    """월별·소스별 비례(최대잔여법) 층화 표본. 층 크기가 배분량보다 작으면 전수 + 잔여 재배분."""
    if len(posts) <= max_n:
        return list(posts), False
    rng = random.Random(seed)
    strata: dict[tuple[str, str | None], list[Post]] = {}
    for p in sorted(posts, key=lambda x: x.key):
        strata.setdefault((p.source, month_of(p)), []).append(p)
    keys = sorted(strata, key=lambda k: (k[0], k[1] or ""))
    sizes = {k: len(strata[k]) for k in keys}
    alloc = {k: 0 for k in keys}
    remaining = max_n
    active = set(keys)
    while remaining > 0 and active:
        total = sum(sizes[k] - alloc[k] for k in active)
        if total <= 0:
            break
        exact = {k: remaining * (sizes[k] - alloc[k]) / total for k in active}
        floors = {k: int(exact[k]) for k in active}
        rem = remaining - sum(floors.values())
        for k in sorted(active, key=lambda k: (-(exact[k] - floors[k]), k[0], k[1] or "")):
            if rem <= 0:
                break
            floors[k] += 1
            rem -= 1
        capped = False
        for k in list(active):
            want = alloc[k] + floors[k]
            if want >= sizes[k]:
                alloc[k] = sizes[k]
                active.discard(k)
                capped = True
            else:
                alloc[k] = want
        remaining = max_n - sum(alloc.values())
        if not capped:
            break
    out: list[Post] = []
    for k in keys:
        pool = strata[k]
        n = alloc[k]
        out.extend(pool if n >= len(pool) else rng.sample(pool, n))
    return out, True


@dataclass
class ClassifyResult:
    judgments: list[Judgment]
    n_cached: int = 0
    n_new: int = 0
    n_failed: int = 0
    n_injection: int = 0
    prompt_hash: str = ""
    model: str = ""
    quotes_dropped: int = 0
    n_calls: int = 0
    errors: list[str] = field(default_factory=list)


def _post_block(idx: int, p: Post) -> str:
    body = " ".join((p.body or "").split())
    if len(body) > BODY_MAX_CHARS:
        body = body[:BODY_MAX_CHARS]
    head = (p.title or "").strip()
    meta = f" 별점{p.rating}" if p.rating is not None else ""
    return f'<post id="{idx}">{meta}\n{head}\n{body}\n</post>'


def build_user(pain: str, target: str, posts: list[Post]) -> str:
    blocks = "\n".join(_post_block(i + 1, p) for i, p in enumerate(posts))
    return f"페인: {pain}\n타깃: {target}\n\n{blocks}"


def _build_user(pain: str, target: str, p: Post) -> str:  # 하위 호환(측정 스크립트용)
    return build_user(pain, target, [p])


def _load_cache(conn: sqlite3.Connection, keys: list[str], pain_hash: str, ph: str, model: str) -> dict[str, Judgment]:
    out: dict[str, Judgment] = {}
    for i in range(0, len(keys), 400):
        chunk = keys[i:i + 400]
        rows = conn.execute(
            "SELECT * FROM judgments WHERE pain_hash=? AND prompt_hash=? AND model=? AND status='ok' "
            "AND post_key IN (%s)" % ",".join("?" * len(chunk)),
            [pain_hash, ph, model, *chunk],
        ).fetchall()
        for r in rows:
            qs = [QuoteCandidate(**q) for q in json.loads(r["quotes_json"] or "[]")]
            out[r["post_key"]] = Judgment(
                post_id=r["post_key"], relevant=bool(r["relevant"]), intensity=int(r["intensity"] or 0),
                quotes=qs, model=model, prompt_hash=ph, pain_hash=pain_hash, status="ok",
                injection_flag=bool(r["injection_flag"]), cached=True,
            )
    return out


def _save(conn: sqlite3.Connection, js: list[Judgment]) -> None:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [
        (j.post_id, j.pain_hash, j.prompt_hash, j.model, int(j.relevant), int(j.intensity),
         json.dumps([q.__dict__ for q in j.quotes], ensure_ascii=False), int(j.injection_flag),
         j.status, j.error, now)
        for j in js
    ]
    with conn:
        conn.executemany(
            "INSERT INTO judgments(post_key, pain_hash, prompt_hash, model, relevant, intensity, quotes_json,"
            " injection_flag, status, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(post_key, pain_hash, prompt_hash, model) DO UPDATE SET"
            " relevant=excluded.relevant, intensity=excluded.intensity, quotes_json=excluded.quotes_json,"
            " injection_flag=excluded.injection_flag, status=excluded.status, error=excluded.error,"
            " created_at=excluded.created_at",
            rows,
        )


def _failed(p: Post, *, model: str, ph: str, pain_hash: str, error: str, injection: bool = False) -> Judgment:
    return Judgment(post_id=p.key, relevant=False, intensity=0, model=model, prompt_hash=ph, pain_hash=pain_hash,
                    status="failed", injection_flag=injection, error=error[:300])


def postprocess(raw: dict, p: Post, *, model: str, ph: str, pain_hash: str) -> tuple[Judgment, int]:
    """LLM 원응답(글 1건분) → Judgment. 반환 (judgment, 폐기된 인용 수)."""
    relevant = bool(raw.get("relevant"))
    try:
        intensity = int(raw.get("intensity", 0))
    except (TypeError, ValueError):
        intensity = 0
    intensity = max(0, min(3, intensity))
    injection = bool(raw.get("inj", raw.get("injection_suspected"))) or bool(_INJECTION_RE.search(p.index_text()))
    if relevant and intensity == 0:
        return _failed(p, model=model, ph=ph, pain_hash=pain_hash, error="판정 오류: relevant=true & intensity=0",
                       injection=injection), 0
    if not relevant:
        intensity = 0
    quotes: list[QuoteCandidate] = []
    dropped = 0
    body = p.index_text()
    raw_quotes = raw.get("quotes") or []
    if relevant and not injection:
        for q in raw_quotes[:2]:
            if not isinstance(q, str):
                dropped += 1
                continue
            text = clip_quote(q, config.QUOTE_MAX_CHARS)
            if not verify_quote(text, body):
                dropped += 1
                continue
            quotes.append(QuoteCandidate(text=text, verified=True,
                                         context_excerpt=excerpt_context(body, text, config.QUOTE_MAX_CHARS)))
    elif relevant and injection:
        dropped += len(raw_quotes)
    return Judgment(post_id=p.key, relevant=relevant, intensity=intensity, quotes=quotes, model=model,
                    prompt_hash=ph, pain_hash=pain_hash, status="ok", injection_flag=injection), dropped


def classify(sample: list[Post], pain: str, target: str, pain_hash: str, llm: LLM, *,
             db_path: str | Path, model: str | None = None, concurrency: int = config.LLM_CONCURRENCY,
             batch_size: int | None = None, job_id: str | None = None, progress=None) -> ClassifyResult:
    model = model or config.MODEL_CLASSIFY
    batch_size = max(1, batch_size or config.CLASSIFY_BATCH)
    system = load_prompt("classify")
    ph = prompt_hash(system)
    res = ClassifyResult(judgments=[], prompt_hash=ph, model=model)
    keys = [p.key for p in sample]
    conn = db.open_read(db_path)
    try:
        cache = _load_cache(conn, keys, pain_hash, ph, model)
    finally:
        conn.close()
    todo = [p for p in sample if p.key not in cache]
    res.n_cached = len(cache)
    res.n_new = len(todo)
    batches = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    if batches:
        llm.check_daily_limit(len(batches))
        # 판정 전체의 최대 비용을 먼저 견적 → 예산을 넘으면 한 건도 보내지 않는다(중간에 멈춰 돈만 쓰는 일 방지)
        pin, pout = price_of(model)
        est_in = sum(estimate_tokens(system + build_user(pain, target, bt)) for bt in batches)
        est_out = sum(OUT_TOKENS_PER_POST * len(bt) + 60 for bt in batches)
        llm.check_budget((est_in * pin + est_out * pout) / 1_000_000)

    def work(batch: list[Post]) -> tuple[list[tuple[Judgment, int]], int]:
        try:
            raw = llm.call("classify", model, system, build_user(pain, target, batch), schema=JUDGMENT_SCHEMA,
                           prompt_hash=ph, max_tokens=OUT_TOKENS_PER_POST * len(batch) + 60, retries=3,
                           job_id=job_id, required=("judgments",))
        except LLMError as e:
            return [(_failed(p, model=model, ph=ph, pain_hash=pain_hash, error=str(e)), 0) for p in batch], 1
        by_id: dict[str, dict] = {}
        for item in raw.get("judgments") or []:
            if isinstance(item, dict):
                by_id.setdefault(str(item.get("id", "")).strip(), item)
        out = []
        for i, p in enumerate(batch):
            item = by_id.get(str(i + 1))
            if item is None:
                out.append((_failed(p, model=model, ph=ph, pain_hash=pain_hash, error="응답에 id 누락"), 0))
            else:
                out.append(postprocess(item, p, model=model, ph=ph, pain_hash=pain_hash))
        return out, 1

    new: list[Judgment] = []
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        for items, n_calls in ex.map(work, batches):
            res.n_calls += n_calls
            for j, dropped in items:
                new.append(j)
                res.quotes_dropped += dropped
            done += len(items)
            if progress and (done % 25 < len(items) or done == len(todo)):
                progress(f"판정 {done}/{len(todo)} (캐시 {res.n_cached}, 호출 {res.n_calls})")
    if new:
        wconn = db.open_write(db_path)
        try:
            _save(wconn, new)
        finally:
            wconn.close()
    order = {k: i for i, k in enumerate(keys)}
    allj = list(cache.values()) + new
    allj.sort(key=lambda j: order.get(j.post_id, 1 << 30))
    res.judgments = allj
    res.n_failed = sum(1 for j in allj if j.status != "ok")
    res.n_injection = sum(1 for j in allj if j.injection_flag)
    return res
