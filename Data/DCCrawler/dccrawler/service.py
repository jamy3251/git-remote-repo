"""크롤링 → 저장 → 분석을 묶는 서비스 계층 (CLI/웹 공용)."""
from __future__ import annotations

from . import analysis
from .analysis import cross, keywords
from .models import CrawlResult
from .sources import get_source
from .storage import DEFAULT_DB, Store


def crawl_and_analyze(
    source: str,
    board: str,
    start_page: int,
    end_page: int,
    *,
    fetch_body: bool = False,
    delay: float = 1.0,
    use_llm: bool = True,
    store: bool = True,
    progress=None,
    db_path=DEFAULT_DB,
) -> dict:
    src = get_source(source)
    posts = src.crawl(board, start_page, end_page,
                      fetch_body=fetch_body, delay=delay, progress=progress)
    if store and posts:
        Store(db_path, auto_migrate=True).upsert_posts(posts)
    result = CrawlResult(source, board, start_page, end_page, posts)
    insight = analysis.run(posts, source, board, use_llm=use_llm)
    return {"crawl": result.to_dict(), "analysis": insight}


def cross_analyze(
    targets: list[tuple[str, str]],
    start_page: int,
    end_page: int,
    *,
    fetch_body: bool = False,
    delay: float = 1.0,
    use_llm: bool = True,
    store: bool = True,
    progress=None,
    db_path=DEFAULT_DB,
) -> dict:
    """여러 (source, board)를 크롤링해 교차 분석한다."""
    per_source: list[dict] = []
    for source, board in targets:
        if progress:
            progress(f"▶ {source}/{board} 수집 시작…")
        try:
            src = get_source(source)
            posts = src.crawl(board, start_page, end_page,
                              fetch_body=fetch_body, delay=delay, progress=progress)
        except Exception as e:
            if progress:
                progress(f"⚠ {source}/{board} 건너뜀: {e}")
            continue
        if store and posts:
            Store(db_path, auto_migrate=True).upsert_posts(posts)
        per_source.append({
            "source": source, "board": board, "posts": posts,
            "keywords": keywords.analyze(posts, top_n=60),
        })
    if not per_source:
        return {"error": "수집된 소스가 없습니다."}
    return cross.build(per_source, use_llm=use_llm)

