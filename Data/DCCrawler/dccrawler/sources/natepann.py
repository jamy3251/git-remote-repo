"""네이트판(Nate Pann) 어댑터.

board = /talk/ 하위 경로 (기본 'ranking' 톡커들의 선택 랭킹).
예: ranking(랭킹), c20(연예), c30(사회) ...
목록의 미리보기 텍스트(dd.txt)를 본문 스니펫으로 함께 담아 분석 정확도를 높인다.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..models import Post
from .base import BaseSource, make_client, now_iso

HOST = "https://pann.nate.com"


def _digits(s: str) -> int:
    m = re.search(r"\d[\d,]*", s or "")
    return int(m.group().replace(",", "")) if m else 0


class NatepannSource(BaseSource):
    name = "natepann"
    needs_board = True

    def __init__(self) -> None:
        self.client = make_client(headers={"Referer": HOST + "/"})

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        cat = board or "ranking"
        posts: list[Post] = []
        seen: set[str] = set()
        for page in range(start_page, end_page + 1):
            url = f"{HOST}/talk/{cat}?page={page}"
            try:
                r = self.client.get(url)
                r.encoding = "utf-8"
                soup = BeautifulSoup(r.text, "lxml")
            except Exception as e:  # pragma: no cover
                if progress:
                    progress(f"[{page}p] 오류: {e}")
                continue
            n0 = len(posts)
            for li in soup.select("ul.post_wrap li"):
                a = li.select_one("dt h2 a") or li.select_one("dl dt a")
                if not a:
                    continue
                href = a.get("href", "")
                m = re.search(r"/talk/(\d+)", href)
                if not m:
                    continue
                pid = m.group(1)
                if pid in seen:
                    continue
                seen.add(pid)
                cmt_el = li.select_one(".reple-num")
                cmt = _digits(cmt_el.get_text()) if cmt_el else 0
                snippet = ""
                txt_el = li.select_one("dd.txt")
                if txt_el:
                    snippet = txt_el.get_text(" ", strip=True)
                posts.append(
                    Post(
                        source=self.name, board=cat, post_id=pid,
                        title=a.get("title") or a.get_text(strip=True),
                        url=HOST + href if href.startswith("/") else href,
                        views=_digits(_txt(li, "dd.info .count")),
                        likes=_digits(_txt(li, "dd.info .rcm")),
                        comment_count=cmt, body=snippet, crawled_at=now_iso(),
                    )
                )
            if progress:
                progress(f"[네이트판/{cat}] {page}p 수집 {len(posts)-n0}건 (누적 {len(posts)})")
            self._sleep(delay)
        if fetch_body:
            for i, p in enumerate(posts):
                self._fetch_body(p)
                if progress and i % 10 == 0:
                    progress(f"본문 수집 {i+1}/{len(posts)}")
                self._sleep(delay)
        return posts

    def _fetch_body(self, post: Post) -> None:
        try:
            r = self.client.get(post.url)
            r.encoding = "utf-8"
            soup = BeautifulSoup(r.text, "lxml")
            el = soup.select_one("#contentArea") or soup.select_one(".usertxt") or soup.select_one("#scontent")
            if el:
                post.body = el.get_text("\n", strip=True)
        except Exception:
            pass


def _txt(li, sel: str) -> str:
    el = li.select_one(sel)
    return el.get_text(strip=True) if el else ""
