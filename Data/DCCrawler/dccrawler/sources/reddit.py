"""레딧 어댑터 — OAuth(앱 등록) 방식.

레딧은 비인증 .json 접근을 차단하므로 등록된 앱 자격증명이 필요하다.
https://www.reddit.com/prefs/apps 에서 'script' 타입 앱을 만들고 .env에:
  REDDIT_CLIENT_ID=...
  REDDIT_CLIENT_SECRET=...
board = 서브레딧 이름(예: 'Construction').
"""
from __future__ import annotations

import os

from ..models import Post
from .base import BaseSource, make_client, now_iso


class RedditSource(BaseSource):
    name = "reddit"
    needs_board = True

    def __init__(self) -> None:
        self.cid = os.getenv("REDDIT_CLIENT_ID", "").strip()
        self.secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
        self.ua = "dccrawler/0.1 (pain-point research)"
        self.client = make_client(headers={"User-Agent": self.ua})

    def _token(self) -> str:
        r = self.client.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(self.cid, self.secret),
            data={"grant_type": "client_credentials"},
        )
        r.raise_for_status()
        return r.json()["access_token"]

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        if not (self.cid and self.secret):
            raise RuntimeError(
                "레딧 소스는 OAuth 자격증명이 필요합니다. https://www.reddit.com/prefs/apps 에서 "
                "'script' 앱을 만들고 .env에 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET을 넣어주세요."
            )
        sub = board.lstrip("r/").strip("/")
        token = self._token()
        headers = {"Authorization": f"bearer {token}", "User-Agent": self.ua}
        posts: list[Post] = []
        after = None
        for page in range(1, end_page + 1):
            url = f"https://oauth.reddit.com/r/{sub}/new?limit=100"
            if after:
                url += f"&after={after}"
            try:
                r = self.client.get(url, headers=headers)
                data = r.json()
            except Exception as e:  # pragma: no cover
                if progress:
                    progress(f"[{page}p] 오류: {e}")
                break
            children = data.get("data", {}).get("children", [])
            after = data.get("data", {}).get("after")
            if page >= start_page:
                for c in children:
                    d = c.get("data", {})
                    posts.append(
                        Post(
                            source=self.name, board=sub, post_id=d.get("id", ""),
                            title=d.get("title", ""),
                            url="https://www.reddit.com" + d.get("permalink", ""),
                            author=d.get("author", ""),
                            created_at=str(d.get("created_utc", "")),
                            likes=d.get("score", 0),
                            comment_count=d.get("num_comments", 0),
                            body=d.get("selftext", "") if fetch_body else "",
                            crawled_at=now_iso(),
                        )
                    )
                if progress:
                    progress(f"[r/{sub}] {page}p 수집 (누적 {len(posts)})")
            if not after:
                break
            self._sleep(delay)
        return posts
