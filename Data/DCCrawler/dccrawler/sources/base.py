"""소스 어댑터 공통 인터페이스 + HTTP 클라이언트 유틸."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx

from ..models import Post

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


class ParserDriftError(RuntimeError):
    """HTTP 200 + 본문 있음 + 글 행 셀렉터 0개 → 사이트 마크업이 바뀐 것으로 의심."""

    def __init__(self, source: str, board: str, url: str, html_len: int):
        self.source, self.board, self.url, self.html_len = source, board, url, html_len
        super().__init__(f"{source}/{board}: 200 OK({html_len}B)인데 글 행 0개 — 파서 드리프트 의심 ({url})")


class EmptyResponseError(RuntimeError):
    """HTTP 200인데 본문 0바이트 → 과다 요청 일시 차단 의심. ok 0건으로 기록하지 말 것."""

    def __init__(self, source: str, board: str, url: str):
        self.source, self.board, self.url = source, board, url
        super().__init__(f"{source}/{board}: 200 OK인데 본문 0바이트 — 일시 차단 의심 ({url})")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def make_client(headers: dict | None = None, timeout: float = 20.0) -> httpx.Client:
    base = {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if headers:
        base.update(headers)
    return httpx.Client(headers=base, timeout=timeout, follow_redirects=True)


class BaseSource:
    """모든 소스 어댑터가 구현해야 하는 인터페이스."""

    name: str = "base"
    # board가 필요한 소스인지(디시=갤러리ID, 레딧=서브레딧). False면 board 무시.
    needs_board: bool = True
    # 작성자 식별 등급 기본값(소스 단위). 글 단위로 다르면 어댑터가 Post에 직접 채운다.
    author_id_kind: str = "none"

    def crawl(
        self,
        board: str,
        start_page: int,
        end_page: int,
        *,
        fetch_body: bool = False,
        delay: float = 1.0,
        progress=None,
    ) -> list[Post]:
        """[start_page, end_page] 범위의 글 목록을 수집해 Post 리스트로 반환."""
        raise NotImplementedError

    @staticmethod
    def _sleep(delay: float) -> None:
        if delay > 0:
            time.sleep(delay)
