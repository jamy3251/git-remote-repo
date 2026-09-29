"""디시인사이드 갤러리 어댑터.

정식/마이너(mgallery)/미니(mini) 갤러리를 자동 감지해 목록을 크롤링한다.
board = 갤러리 ID (예: 'joonjangbee'). 옵션으로 'mini:joonjangbee' 처럼
타입을 명시할 수도 있다.

작성자 식별:
- 고정닉: td.gall_writer[data-uid] → author_id = uid, kind = strong
- 유동닉: td.gall_writer[data-ip] (디시는 IP 앞 2옥텟만 노출) → author_id = "121.135", kind = weak
- 둘 다 없으면 kind = none

파서 드리프트 가드: 첫 페이지가 200 OK + 본문 있음인데 글 행이 0개면 ParserDriftError.
빈 응답 가드: 200 OK + 본문 0바이트면 EmptyResponseError(과다 요청 일시 차단 — 요청 간격을 늘려 재시도).
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

from ..models import Post
from .base import BaseSource, EmptyResponseError, ParserDriftError, make_client, now_iso

HOST = "https://gall.dcinside.com"
_PATHS = {
    "main": "/board",
    "mgallery": "/mgallery/board",
    "mini": "/mini/board",
}
_NUM_RE = re.compile(r"^\d+$")
_IP2_RE = re.compile(r"^(\d{1,3})\.(\d{1,3})")
_NICK_IP_RE = re.compile(r"\((\d{1,3}\.\d{1,3})\)\s*$")
MIN_HTML_FOR_DRIFT = 2000


def parse_author_id(nick: str | None, uid: str | None, ip: str | None) -> tuple[str | None, str]:
    """(author_id, author_id_kind). 고정닉 uid > 유동닉 ip 2옥텟 > 닉 문자열의 '(121.135)' > none."""
    uid = (uid or "").strip()
    if uid:
        return uid, "strong"
    ip = (ip or "").strip()
    m = _IP2_RE.match(ip)
    if m:
        return f"{m.group(1)}.{m.group(2)}", "weak"
    m = _NICK_IP_RE.search(nick or "")
    if m:
        return m.group(1), "weak"
    return None, "none"


class DcinsideSource(BaseSource):
    name = "dcinside"
    needs_board = True
    author_id_kind = "strong"  # 글 단위로 strong/weak/none 혼재

    def __init__(self) -> None:
        self.client = make_client(headers={"Referer": HOST + "/"})
        self._type_cache: dict[str, str] = {}

    # ---- 갤러리 타입 감지 ----
    def _parse_board(self, board: str) -> tuple[str, str | None]:
        if ":" in board:
            gtype, gid = board.split(":", 1)
            return gid, gtype if gtype in _PATHS else None
        return board, None

    def _detect_type(self, gid: str, hint: str | None) -> str:
        if gid in self._type_cache:
            return self._type_cache[gid]
        order = [hint] if hint else []
        order += [t for t in ("mini", "mgallery", "main") if t not in order]
        for gtype in order:
            if not gtype:
                continue
            url = f"{HOST}{_PATHS[gtype]}/lists/?id={gid}&page=1"
            try:
                r = self.client.get(url)
                r.encoding = "utf-8"
                if r.status_code == 200 and self._parse_rows(r.text, gtype, gid):
                    self._type_cache[gid] = gtype
                    return gtype
            except httpx_error():  # pragma: no cover
                continue
        # 못 찾으면 일단 main으로 가정
        self._type_cache[gid] = "main"
        return "main"

    # ---- 목록 파싱 ----
    def _parse_rows(self, html: str, gtype: str, gid: str) -> list[Post]:
        soup = BeautifulSoup(html, "lxml")
        posts: list[Post] = []
        for tr in soup.select("table.gall_list tbody tr.ub-content"):
            num_el = tr.select_one("td.gall_num")
            num = num_el.get_text(strip=True) if num_el else ""
            if not _NUM_RE.match(num):  # 공지/AD/설문 행 제외
                continue
            tit = tr.select_one("td.gall_tit a")
            if not tit:
                continue
            href = tit.get("href", "")
            url = href if href.startswith("http") else HOST + href
            reply = tr.select_one("td.gall_tit a.reply_numbox span.reply_num")
            reply_n = 0
            if reply:
                m = re.search(r"\d+", reply.get_text())
                reply_n = int(m.group()) if m else 0
            writer_el = tr.select_one("td.gall_writer")
            author, author_id, kind = "", None, "none"
            if writer_el:
                author = writer_el.get("data-nick") or writer_el.get_text(strip=True)
                author_id, kind = parse_author_id(
                    writer_el.get_text(" ", strip=True), writer_el.get("data-uid"),
                    writer_el.get("data-ip"),
                )
            date_el = tr.select_one("td.gall_date")
            created = ""
            if date_el:
                created = date_el.get("title") or date_el.get_text(strip=True)
            views_el = tr.select_one("td.gall_count")
            likes_el = tr.select_one("td.gall_recommend")
            posts.append(
                Post(
                    source=self.name, board=gid, post_id=num,
                    title=tit.get_text(strip=True) or None, url=url, author=author,
                    author_id=author_id, author_id_kind=kind,
                    created_at=created,
                    views=_to_int(views_el.get_text(strip=True) if views_el else "0"),
                    likes=_to_int(likes_el.get_text(strip=True) if likes_el else "0"),
                    comment_count=reply_n, crawled_at=now_iso(),
                )
            )
        return posts

    # ---- 본문 + 댓글 파싱 ----
    def _fetch_detail(self, post: Post) -> None:
        try:
            r = self.client.get(post.url)
            r.encoding = "utf-8"
            html = r.text
            soup = BeautifulSoup(html, "lxml")
            body_el = soup.select_one(".write_div") or soup.select_one(".writing_view_box")
            if body_el:
                post.body = body_el.get_text("\n", strip=True)
            # 댓글 AJAX (e_s_n_o 토큰 + _GALLTYPE_ 필요)
            esno = re.search(r'name="e_s_n_o" value="([^"]+)"', html)
            gtype = re.search(r'name="_GALLTYPE_"[^>]*value="([^"]+)"', html)
            if esno:
                post.comments = self._fetch_comments(
                    post.board, post.post_id, esno.group(1),
                    gtype.group(1) if gtype else "G", post.url,
                )
        except Exception:
            pass

    def _fetch_comments(self, gid, no, esno, gtype, referer, max_pages=2):
        out: list[str] = []
        for cpage in range(1, max_pages + 1):
            data = {
                "id": gid, "no": no, "cmt_id": gid, "cmt_no": no,
                "e_s_n_o": esno, "comment_page": str(cpage), "_GALLTYPE_": gtype,
            }
            try:
                r = self.client.post(
                    HOST + "/board/comment/", data=data,
                    headers={"X-Requested-With": "XMLHttpRequest", "Referer": referer,
                             "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                )
                j = r.json()
            except Exception:
                break
            comments = j.get("comments") or []
            if not comments:
                break
            for cm in comments:
                memo = re.sub(r"<[^>]+>", " ", cm.get("memo", "") or "").strip()
                if memo and "삭제" not in memo[:20]:
                    out.append(memo)
            if len(comments) < 100:
                break
        return out

    # ---- 진입점 ----
    def crawl(self, board, start_page, end_page, *, fetch_body=False, delay=1.0, progress=None):
        gid, hint = self._parse_board(board)
        gtype = self._detect_type(gid, hint)
        all_posts: list[Post] = []
        seen: set[str] = set()
        for page in range(start_page, end_page + 1):
            url = f"{HOST}{_PATHS[gtype]}/lists/?id={gid}&page={page}"
            r = self.client.get(url)
            r.encoding = "utf-8"
            rows = self._parse_rows(r.text, gtype, gid)
            if page == start_page and not rows and r.status_code == 200:
                if len(r.text) == 0:
                    # 디시는 과다 요청 시 200 + 빈 본문을 돌려준다(일시 차단). ok 0건으로 기록되면 안 된다.
                    raise EmptyResponseError(self.name, gid, url)
                if len(r.text) >= MIN_HTML_FOR_DRIFT:
                    raise ParserDriftError(self.name, gid, url, len(r.text))
            for p in rows:
                if p.post_id in seen:
                    continue
                seen.add(p.post_id)
                all_posts.append(p)
            if progress:
                progress(f"[{gtype}/{gid}] {page}p 수집 {len(rows)}건 (누적 {len(all_posts)})")
            self._sleep(delay)
        if fetch_body:
            for i, p in enumerate(all_posts):
                self._fetch_detail(p)
                if progress and i % 10 == 0:
                    progress(f"본문+댓글 수집 {i+1}/{len(all_posts)}")
                self._sleep(delay)
        return all_posts


def _to_int(s: str) -> int:
    s = s.replace(",", "").strip()
    if s.endswith("k") or s.endswith("K"):
        try:
            return int(float(s[:-1]) * 1000)
        except ValueError:
            return 0
    m = re.search(r"\d+", s)
    return int(m.group()) if m else 0


def httpx_error():
    import httpx
    return (httpx.HTTPError,)
