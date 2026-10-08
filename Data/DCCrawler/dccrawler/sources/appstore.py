"""앱스토어(iOS) 앱 리뷰 어댑터 — 공개 RSS(JSON) 피드.

board = 앱 숫자 ID (예: '362057947' 카카오톡). 국가는 kr. 페이지 1개 = 최신순 리뷰 50건, 최대 10페이지(피드 한도).
- title = 리뷰 제목, url 없음(None; 리뷰별 고유 주소가 없다). source_ref = 앱 페이지 URL + 리뷰 id.
- author_id 없음(none): 스토어 닉네임은 동일인 판정 불가(구글플레이와 같은 규약).
- rating = 별점(1~5). created_at = 피드의 updated(ISO, 시간대 포함).
- 첫 항목이 리뷰가 아닌 앱 정보인 피드가 있어 im:rating이 없는 항목은 건너뛴다.
"""
from __future__ import annotations

import httpx

from ..models import Post
from .base import BaseSource, EmptyResponseError, ParserDriftError, now_iso

FEED = "https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={app_id}/sortby=mostrecent/json"
MAX_PAGES = 10


def app_url(app_id: str, country: str = "kr") -> str:
    return f"https://apps.apple.com/{country}/app/id{app_id}"


def _label(e: dict, key: str) -> str:
    v = e.get(key)
    return str(v.get("label", "")) if isinstance(v, dict) else ""


def entry_to_post(app_id: str, e: dict, crawled_at: str | None = None) -> Post | None:
    rating = _label(e, "im:rating")
    rid = _label(e, "id")
    if not rating or not rid:
        return None
    author = e.get("author") or {}
    name = author.get("name", {}).get("label", "") if isinstance(author.get("name"), dict) else ""
    return Post(
        source="appstore", board=app_id, post_id=rid,
        title=_label(e, "title") or None, url=None, author=name,
        author_id=None, author_id_kind="none",
        created_at=_label(e, "updated"), body=_label(e, "content"), rating=int(rating),
        source_ref=f"{app_url(app_id)}#reviewId={rid}", crawled_at=crawled_at or now_iso(),
    )


def parse_feed(app_id: str, data: dict, crawled_at: str | None = None) -> list[Post]:
    feed = data.get("feed") if isinstance(data, dict) else None
    if feed is None:
        raise ParserDriftError("appstore: feed 키 없음")
    entries = feed.get("entry") or []
    if isinstance(entries, dict):        # 리뷰가 1건이면 리스트가 아니라 객체로 온다
        entries = [entries]
    return [p for p in (entry_to_post(app_id, e, crawled_at) for e in entries) if p]


class AppStoreSource(BaseSource):
    name = "appstore"
    needs_board = True
    author_id_kind = "none"

    def __init__(self, client: httpx.Client | None = None, country: str = "kr"):
        self.client = client or httpx.Client(timeout=30, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
        self.country = country

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        app_id = board.strip()
        out: list[Post] = []
        for page in range(start_page, min(end_page, MAX_PAGES) + 1):
            r = self.client.get(FEED.format(country=self.country, page=page, app_id=app_id))
            if r.status_code != 200:
                raise EmptyResponseError(f"appstore: HTTP {r.status_code} ({app_id} {page}p)")
            try:
                data = r.json()
            except ValueError as e:
                raise ParserDriftError("appstore: JSON 아님") from e
            batch = parse_feed(app_id, data, now_iso())
            out.extend(batch)
            if progress:
                progress(f"[appstore/{app_id}] {page}p 리뷰 {len(batch)}건 (누적 {len(out)})")
            if not batch:
                break
            self._sleep(delay)
        return out
