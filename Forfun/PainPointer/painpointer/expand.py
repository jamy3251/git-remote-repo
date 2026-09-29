"""1단계 expand_query: LLM 유의어 확장 + 실패 시 원문 폴백 + 8a 적중 미리보기."""
from __future__ import annotations

from dataclasses import dataclass

from dccrawler.storage import Store

from . import config
from .llm import LLM, LLMError, load_prompt
from .models import Query
from .search import dedup, load_posts_by_keys
from .textnorm import fts_match, normalize_ws, prompt_hash, term_tokens

EXPAND_SCHEMA = {
    "type": "object",
    "properties": {"terms": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 12}},
    "required": ["terms"],
    "additionalProperties": False,
}
MAX_TERMS = 12


def base_terms(pain: str, target: str) -> list[str]:
    """LLM 없이 만드는 기본 검색어: 페인 문장 자체(형태소 NEAR)."""
    out = []
    p = normalize_ws(pain)
    if p and term_tokens(p):
        out.append(p)
    return out


def clean_terms(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        t = normalize_ws(str(t)).strip('"\'()*')
        if not t or not term_tokens(t):
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out[:MAX_TERMS]


def expand_query(pain: str, target: str, llm: LLM | None, *, model: str | None = None,
                 job_id: str | None = None, retries: int = 2) -> Query:
    """검색어 확장. 실패해도 예외를 던지지 않고 expansion_status에 사유를 기록한다."""
    pain = normalize_ws(pain)
    target = normalize_ws(target)
    base = base_terms(pain, target)
    q = Query(pain=pain, target=target, terms=list(base), generated_terms=[], expansion_status="ok")
    if llm is None:
        q.expansion_status = "failed(LLM 미사용)"
        return q
    system = load_prompt("expand")
    ph = prompt_hash(system)
    user = f"페인: {pain}\n타깃: {target}"
    try:
        data = llm.call("expand", model or config.MODEL_CLASSIFY, system, user, schema=EXPAND_SCHEMA,
                        prompt_hash=ph, max_tokens=200, retries=retries, job_id=job_id, required=("terms",))
        gen = clean_terms(data.get("terms") or [])
        if not gen:
            raise LLMError("확장 결과가 비어 있음")
        q.generated_terms = gen
        q.terms = clean_terms(base + gen)
    except LLMError as e:
        q.expansion_status = f"failed({e})"[:200]
        q.terms = list(base)
    return q


@dataclass
class HitPreview:
    per_term: list[tuple[str, int]]     # (검색어, 중복 제거 전 적중 수)
    n_raw_union: int                    # 합집합(중복 제거 전)
    n_dedup: int                        # 규칙 (1)(2)(3) 실제 적용 후
    empty_terms: list[str]              # 토큰이 없어 거부된 검색어


def preview_hits(store: Store, terms: list[str], *, sources: list[str] | None, since_day: str | None) -> HitPreview:
    per_term: list[tuple[str, int]] = []
    empty: list[str] = []
    union: set[str] = set()
    for t in terms:
        m = fts_match([t])
        if m is None:
            empty.append(t)
            continue
        keys = store.search_keys(m, sources=sources, since_day=since_day)
        per_term.append((t, len(keys)))
        union.update(keys)
    n_dedup = 0
    if union:
        posts = load_posts_by_keys(store, sorted(union))
        n_dedup = len(dedup(posts).posts)
    return HitPreview(per_term=per_term, n_raw_union=len(union), n_dedup=n_dedup, empty_terms=empty)
