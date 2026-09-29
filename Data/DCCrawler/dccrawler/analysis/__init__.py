"""분석 파이프라인: 키워드 통계(항상) + LLM 페인포인트(선택)."""
from __future__ import annotations

from ..models import Post
from . import keywords, painpoints


def run(posts: list[Post], source: str, board: str, *, use_llm: bool = True) -> dict:
    kw = keywords.analyze(posts)
    llm = painpoints.analyze(posts, source, board) if use_llm else {"available": False,
                                                                     "reason": "비활성화됨"}
    return {"keywords": kw, "llm": llm}
