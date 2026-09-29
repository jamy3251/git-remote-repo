"""구글플레이 앱 리뷰 어댑터 (google-play-scraper).

board = 앱 패키지 ID (예: 'com.kakao.talk'). 페이지 1개 = 최신순 리뷰 REVIEWS_PER_PAGE건.
- title/url 없음(None). source_ref = 앱 페이지 URL + reviewId (설계의 출처 표기 규약).
- author_id 없음(none): 스토어 닉네임은 동일인 판정 불가.
- rating = 별점(1~5). created_at = ISO.
"""
from __future__ import annotations

from ..models import Post
from .base import BaseSource, now_iso

REVIEWS_PER_PAGE = 200


def app_url(app_id: str) -> str:
    return f"https://play.google.com/store/apps/details?id={app_id}&hl=ko"


def review_to_post(app_id: str, r: dict, crawled_at: str | None = None) -> Post:
    at = r.get("at")
    created = at.isoformat(timespec="seconds") if hasattr(at, "isoformat") else str(at or "")
    rid = str(r.get("reviewId") or "")
    score = r.get("score")
    return Post(
        source="googleplay", board=app_id, post_id=rid,
        title=None, url=None, author=str(r.get("userName") or ""),
        author_id=None, author_id_kind="none",
        created_at=created, likes=int(r.get("thumbsUpCount") or 0),
        body=str(r.get("content") or ""), rating=int(score) if score is not None else None,
        source_ref=f"{app_url(app_id)}#reviewId={rid}",
        crawled_at=crawled_at or now_iso(),
    )


class GooglePlaySource(BaseSource):
    name = "googleplay"
    needs_board = True
    author_id_kind = "none"

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        try:
            from google_play_scraper import Sort, reviews
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("pip install google-play-scraper 필요") from e
        app_id = board.strip()
        out: list[Post] = []
        token = None
        for page in range(1, end_page + 1):
            batch, token = reviews(
                app_id, lang="ko", country="kr", sort=Sort.NEWEST,
                count=REVIEWS_PER_PAGE, continuation_token=token,
            )
            if page >= start_page:
                now = now_iso()
                out.extend(review_to_post(app_id, r, now) for r in batch)
                if progress:
                    progress(f"[googleplay/{app_id}] {page}p 리뷰 {len(batch)}건 (누적 {len(out)})")
            if not batch or token is None:
                break
            self._sleep(delay)
        return out
