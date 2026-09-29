"""유튜브 댓글 어댑터 — YouTube Data API v3 사용(YOUTUBE_API_KEY 필요).

board = 영상 ID(예: 'dQw4w9WgXcQ'). 페이지는 댓글 페이지네이션(페이지당 100개).
키가 없으면 명확한 안내와 함께 예외를 던진다.
"""
from __future__ import annotations

import os

from ..models import Post
from .base import BaseSource, make_client, now_iso

API = "https://www.googleapis.com/youtube/v3/commentThreads"


class YoutubeSource(BaseSource):
    name = "youtube"
    needs_board = True

    def __init__(self) -> None:
        self.client = make_client()
        self.key = os.getenv("YOUTUBE_API_KEY", "").strip()

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        if not self.key:
            raise RuntimeError(
                "유튜브 소스는 YOUTUBE_API_KEY 환경변수가 필요합니다. .env에 키를 넣어주세요."
            )
        video_id = board
        posts: list[Post] = []
        token = None
        for page in range(1, end_page + 1):
            params = {
                "part": "snippet", "videoId": video_id, "maxResults": 100,
                "textFormat": "plainText", "key": self.key,
            }
            if token:
                params["pageToken"] = token
            try:
                r = self.client.get(API, params=params)
                data = r.json()
            except Exception as e:  # pragma: no cover
                if progress:
                    progress(f"[{page}p] 오류: {e}")
                break
            if page >= start_page:
                for item in data.get("items", []):
                    sn = item["snippet"]["topLevelComment"]["snippet"]
                    posts.append(
                        Post(
                            source=self.name, board=video_id,
                            post_id=item["id"], title=sn.get("textDisplay", "")[:120],
                            url=f"https://youtu.be/{video_id}",
                            author=sn.get("authorDisplayName", ""),
                            created_at=sn.get("publishedAt", ""),
                            likes=sn.get("likeCount", 0),
                            body=sn.get("textDisplay", "") if fetch_body else "",
                            crawled_at=now_iso(),
                        )
                    )
                if progress:
                    progress(f"[yt:{video_id}] {page}p 수집 (누적 {len(posts)})")
            token = data.get("nextPageToken")
            if not token:
                break
            self._sleep(delay)
        return posts
