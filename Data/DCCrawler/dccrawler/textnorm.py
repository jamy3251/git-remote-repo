"""텍스트 정규화·해시·형태소 토큰화 (DCCrawler와 PainPointer가 공유하는 단일 구현).

- normalize(): NFKC → 공백·기호 제거. 인용 대조·중복 제거(본문 해시)에 쓴다.
- normalize_ws(): NFKC → 연속 공백 1칸. query_hash 등 "문장 그대로" 비교에 쓴다.
- text_hash(): sha256(normalize(text)) hex.
- tokenize(): kiwipiepy 형태소 토큰(내용어만). FTS 색인·검색어 모두 이 함수로 만든다.
- fts_match(): 검색어 목록 → FTS5 MATCH 식(토큰만, 큰따옴표 이스케이프).

NORM_VERSION은 규칙이 바뀔 때 올린다(저장된 해시·토큰의 세대 표시).
"""
from __future__ import annotations

import hashlib
import re
import unicodedata

NORM_VERSION = "1"

_STRIP_RE = re.compile(r"[^0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿぀-ヿ]+")
_WS_RE = re.compile(r"\s+")

# 색인에 남기는 형태소 태그(내용어). 조사·어미·기호는 버린다.
_KEEP_TAGS = {
    "NNG", "NNP", "NNB", "NR", "NP",   # 명사류
    "VV", "VA", "XR",                  # 동사·형용사 어간, 어근
    "SL", "SN", "SH",                  # 외국어·숫자·한자
    "MAG",                             # 일반 부사(너무, 자주)
}
_FALLBACK_TOKEN_RE = re.compile(r"[가-힣]{2,}|[A-Za-z]{2,}|\d+")

_kiwi = None
_kiwi_failed = False


def normalize(text: str | None) -> str:
    """NFKC 정규화 후 공백·특수문자를 전부 제거한다(문자·숫자만 남김)."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    return _STRIP_RE.sub("", t).lower()


def normalize_ws(text: str | None) -> str:
    """NFKC 정규화 + 연속 공백을 한 칸으로. 앞뒤 공백 제거."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    return _WS_RE.sub(" ", t).strip()


def text_hash(text: str | None) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


def _get_kiwi():
    global _kiwi, _kiwi_failed
    if _kiwi is None and not _kiwi_failed:
        try:
            from kiwipiepy import Kiwi
            _kiwi = Kiwi()
        except Exception:
            _kiwi_failed = True
    return _kiwi


def tokenize(text: str | None) -> list[str]:
    """형태소 토큰 목록. kiwipiepy 없으면 정규식 폴백(2자 이상 한글/영문, 숫자)."""
    if not text:
        return []
    text = unicodedata.normalize("NFKC", text)
    kiwi = _get_kiwi()
    if not kiwi:
        return [t.lower() for t in _FALLBACK_TOKEN_RE.findall(text)]
    out: list[str] = []
    for tok in kiwi.tokenize(text):
        tag = tok.tag
        if tag not in _KEEP_TAGS:
            continue
        form = tok.form.strip().lower()
        if not form:
            continue
        if tag in ("VV", "VA") and len(form) < 2:
            # 1음절 동사/형용사 어간(가, 하, 되…)은 잡음이 커서 제외
            continue
        out.append(form)
    return out


def tokens_text(text: str | None) -> str:
    """FTS 컬럼에 저장할 공백 구분 토큰 문자열."""
    return " ".join(tokenize(text))


def _quote(tok: str) -> str:
    return '"' + tok.replace('"', '""') + '"'


def term_tokens(term: str) -> list[str]:
    """검색어 하나 → 토큰 목록(빈 목록이면 확인 화면에서 거부해야 한다)."""
    return tokenize(term)


def fts_match(terms: list[str], near: int = 10) -> str | None:
    """검색어 목록 → FTS5 MATCH 식.

    각 검색어는 형태소 토큰으로만 표현한다(연산자·기호 원천 차단).
    토큰 1개 → "토큰", 여러 개 → NEAR("a" "b", near). 검색어끼리는 OR.
    토큰이 하나도 없으면 None.
    """
    parts: list[str] = []
    for term in terms:
        toks = term_tokens(term)
        if not toks:
            continue
        if len(toks) == 1:
            parts.append(_quote(toks[0]))
        else:
            parts.append("NEAR(" + " ".join(_quote(t) for t in toks) + f", {near})")
    if not parts:
        return None
    return " OR ".join(parts)
