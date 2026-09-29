"""에펨코리아(펨코) 어댑터.

board = 게시판 mid (기본 'best' 포텐). 예: best, humor, football_news ...
※ 펨코는 Cloudflare 봇 차단이 간헐적으로 동작한다. 차단 시 503/HTML이 오면
   잠시 후 재시도하거나 --delay를 늘려라.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..models import Post
from .base import BaseSource, make_client, now_iso

HOST = "https://www.fmkorea.com"


class FmkoreaSource(BaseSource):
    name = "fmkorea"
    needs_board = True

    def __init__(self) -> None:
        self.client = make_client(headers={"Referer": HOST + "/"})

    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        mid = board or "best"
        posts: list[Post] = []
        seen: set[str] = set()
        for page in range(start_page, end_page + 1):
            url = f"{HOST}/{mid}?page={page}"
            items = []
            # Cloudflare 간헐 챌린지 대응: 빈 결과면 잠깐 쉬고 재시도
            for attempt in range(3):
                try:
                    r = self.client.get(url)
                    r.encoding = "utf-8"
                    soup = BeautifulSoup(r.text, "lxml")
                except Exception as e:  # pragma: no cover
                    if progress:
                        progress(f"[{page}p] 오류: {e}")
                    self._sleep(1.0 + attempt)
                    continue
                items = [li for li in soup.select("ul.fm_best_widget li, li.li_best2_pop0")
                         if li.select_one("h3.title a")]
                if not items:  # 정식 게시판(table) 레이아웃 폴백
                    items = [tr for tr in soup.select("table.bd_lst tbody tr")
                             if tr.select_one("td.title a")]
                if items:
                    break
                if progress and attempt < 2:
                    progress(f"[펨코/{mid}] {page}p 빈 응답(차단?) 재시도 {attempt+1}/2")
                self._sleep(1.5 + attempt)
            n0 = len(posts)
            for it in items:
                a = it.select_one("h3.title a") or it.select_one("td.title a")
                if not a:
                    continue
                href = a.get("href", "")
                m = re.search(r"/(\d+)", href) or re.search(r"document_srl=(\d+)", href)
                pid = m.group(1) if m else href
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                cmt_el = it.select_one(".comment_count")
                cmt = int(re.search(r"\d+", cmt_el.get_text()).group()) if cmt_el and re.search(r"\d+", cmt_el.get_text()) else 0
                rec_el = it.select_one("a.pc_voted_count .count") or it.select_one(".count")
                title = re.sub(r"\s*\[\d+\]\s*$", "", a.get_text(strip=True))
                posts.append(
                    Post(
                        source=self.name, board=mid, post_id=pid,
                        title=title,
                        url=href if href.startswith("http") else HOST + "/" + href.lstrip("/"),
                        author=_txt(it, ".author") or _txt(it, "td.author"),
                        likes=int(re.search(r"\d+", rec_el.get_text()).group()) if rec_el and re.search(r"\d+", rec_el.get_text()) else 0,
                        comment_count=cmt, crawled_at=now_iso(),
                    )
                )
            if progress:
                progress(f"[펨코/{mid}] {page}p 수집 {len(posts)-n0}건 (누적 {len(posts)})")
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
            el = soup.select_one("article .xe_content") or soup.select_one(".xe_content")
            if el:
                post.body = el.get_text("\n", strip=True)
        except Exception:
            pass


def _txt(it, sel: str) -> str:
    el = it.select_one(sel)
    return el.get_text(strip=True) if el else ""
