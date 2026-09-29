"""4chan 어댑터 — 공식 읽기 전용 JSON API(a.4cdn.org) 사용.

board = 보드 코드(예: 'g', 'biz'). 4chan 카탈로그는 페이지 1~10.
"""
from __future__ import annotations

import re

from ..models import Post
from .base import BaseSource, make_client, now_iso

_TAG = re.compile(r"<[^>]+>")


def _strip(html: str) -> str:
    return _TAG.sub(" ", html or "").replace("&#039;", "'").replace("&gt;", ">").replace("&quot;", '"').strip()


class FourchanSource(BaseSource):
    name = "fourchan"
    needs_board = True

    def __init__(self) -> None:
        self.client = make_client()

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        posts: list[Post] = []
        for page in range(start_page, min(end_page, 10) + 1):
            url = f"https://a.4cdn.org/{board}/{page}.json"
            try:
                r = self.client.get(url)
                data = r.json()
            except Exception as e:  # pragma: no cover
                if progress:
                    progress(f"[{page}p] 오류: {e}")
                continue
            for thread in data.get("threads", []):
                op = thread.get("posts", [{}])[0]
                title = _strip(op.get("sub", "")) or _strip(op.get("com", ""))[:80]
                posts.append(
                    Post(
                        source=self.name, board=board, post_id=str(op.get("no", "")),
                        title=title,
                        url=f"https://boards.4chan.org/{board}/thread/{op.get('no')}",
                        author=op.get("name", "Anonymous"),
                        created_at=op.get("now", ""),
                        comment_count=op.get("replies", 0),
                        body=_strip(op.get("com", "")) if fetch_body else "",
                        crawled_at=now_iso(),
                    )
                )
            if progress:
                progress(f"[/{board}/] {page}p 수집 (누적 {len(posts)})")
            self._sleep(delay)
        return posts
