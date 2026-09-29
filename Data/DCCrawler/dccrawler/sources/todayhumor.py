"""오늘의유머(오유) 어댑터.

board = 게시판 table 이름 (기본 'bestofbest' 베오베).
예: bestofbest(베오베), humorbest(베스트), total(전체), sisa(시사) ...
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..models import Post
from .base import BaseSource, make_client, now_iso

HOST = "http://www.todayhumor.co.kr"


def _digits(s: str) -> int:
    m = re.search(r"-?\d[\d,]*", s or "")
    return int(m.group().replace(",", "")) if m else 0


class TodayhumorSource(BaseSource):
    name = "todayhumor"
    needs_board = True

    def __init__(self) -> None:
        self.client = make_client(headers={"Referer": HOST})

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        table = board or "bestofbest"
        posts: list[Post] = []
        seen: set[str] = set()
        for page in range(start_page, end_page + 1):
            url = f"{HOST}/board/list.php?table={table}&page={page}"
            try:
                r = self.client.get(url)
                r.encoding = "utf-8"
                soup = BeautifulSoup(r.text, "lxml")
            except Exception as e:  # pragma: no cover
                if progress:
                    progress(f"[{page}p] 오류: {e}")
                continue
            n0 = len(posts)
            for tr in soup.select("table.table_list tr"):
                a = tr.select_one("td.subject a")
                if not a:
                    continue
                href = a.get("href", "")
                m = re.search(r"no=(\d+)", href)
                pid = m.group(1) if m else (tr.select_one("td.no").get_text(strip=True)
                                            if tr.select_one("td.no") else "")
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                subj = a.get_text(strip=True)
                cmt_el = tr.select_one("td.subject")
                cmt = 0
                if cmt_el:
                    m2 = re.search(r"\[(\d+)\]", cmt_el.get_text())
                    cmt = int(m2.group(1)) if m2 else 0
                posts.append(
                    Post(
                        source=self.name, board=table, post_id=pid, title=subj,
                        url=href if href.startswith("http") else HOST + "/board/" + href.lstrip("/"),
                        author=_txt(tr, "td.name"), created_at=_txt(tr, "td.date"),
                        views=_digits(_txt(tr, "td.hits")),
                        likes=_digits(_txt(tr, "td.oknok")), comment_count=cmt,
                        crawled_at=now_iso(),
                    )
                )
            if progress:
                progress(f"[오유/{table}] {page}p 수집 {len(posts)-n0}건 (누적 {len(posts)})")
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
            el = soup.select_one(".viewContent") or soup.select_one("#viewContent")
            if el:
                post.body = el.get_text("\n", strip=True)
        except Exception:
            pass


def _txt(tr, sel: str) -> str:
    el = tr.select_one(sel)
    return el.get_text(strip=True) if el else ""
