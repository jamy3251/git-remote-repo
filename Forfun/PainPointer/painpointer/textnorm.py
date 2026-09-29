"""정규화·해시(DCCrawler textnorm 재수출) + PainPointer 전용 유틸.

- query_hash(pain, target): pain + ' ' + target을 NFKC·연속공백 1칸으로 정규화 후 sha256 앞 16자.
  판정 캐시 키(pain_hash)와 reports.query_hash가 같은 값이다.
- verify_quote(quote, body): 인용 대조 규칙(정규화 후 완전 부분문자열).
- excerpt_context(body, quote, max_chars): 8b 팝오버용 문맥 발췌(quote를 포함하는 원문 부분문자열).
- mask_author(nick): 앞 2자 + ***.
"""
from __future__ import annotations

import hashlib
import unicodedata

from dccrawler.textnorm import (  # noqa: F401  (재수출)
    NORM_VERSION,
    fts_match,
    normalize,
    normalize_ws,
    term_tokens,
    text_hash,
    tokenize,
    tokens_text,
)


def query_hash(pain: str, target: str) -> str:
    s = normalize_ws(f"{pain} {target}")
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def prompt_hash(template: str) -> str:
    return hashlib.sha256(template.encode("utf-8")).hexdigest()[:16]


def verify_quote(quote: str | None, body: str | None) -> bool:
    q = normalize(quote)
    if not q:
        return False
    return q in normalize(body)


def _norm_map(text: str) -> tuple[str, list[int]]:
    """정규화 문자열과, 정규화 문자 i가 원문 몇 번째 문자에서 왔는지의 인덱스 목록."""
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(text):
        n = normalize(ch)
        for c in n:
            out.append(c)
            idx.append(i)
    return "".join(out), idx


def locate_quote(body: str, quote: str) -> tuple[int, int] | None:
    """quote가 body에서 차지하는 원문 [start, end) 범위. 없으면 None."""
    nb, idx = _norm_map(body)
    nq = normalize(quote)
    if not nq:
        return None
    pos = nb.find(nq)
    if pos < 0:
        return None
    start = idx[pos]
    end = idx[pos + len(nq) - 1] + 1
    return start, end


def excerpt_context(body: str, quote: str, max_chars: int = 120) -> str | None:
    """quote를 포함하고 max_chars 이하인 원문 발췌. 잔여 길이를 앞뒤에 균등 배분.

    반환값은 항상 body의 부분문자열이므로 인용 대조 규칙을 통과한다.
    quote 자체가 max_chars보다 길면 None.
    """
    span = locate_quote(body, quote)
    if span is None:
        return None
    s, e = span
    if e - s > max_chars:
        return None
    residual = max_chars - (e - s)
    left = residual // 2
    right = residual - left
    cs = max(0, s - left)
    ce = min(len(body), e + right)
    # 한쪽이 짧으면 남는 만큼 반대쪽으로
    if cs == 0:
        ce = min(len(body), e + (max_chars - (e - cs)))
    if ce == len(body):
        cs = max(0, ce - max_chars)
    ctx = body[cs:ce]
    ctx = " ".join(ctx.split())
    if not verify_quote(quote, ctx) or not verify_quote(ctx, body):
        return None
    return ctx


def mask_author(nick: str | None) -> str | None:
    if not nick:
        return None
    n = unicodedata.normalize("NFC", nick).strip()
    if not n:
        return None
    return n[:2] + "***"


def clip_quote(text: str, max_chars: int = 120) -> str:
    text = " ".join((text or "").split())
    return text[:max_chars]
