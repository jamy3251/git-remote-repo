"""크롤링/분석 공용 데이터 모델."""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Any

AUTHOR_ID_KINDS = ("strong", "weak", "none")


@dataclass
class Post:
    """커뮤니티 글 하나(소스 무관 공통 표현).

    title/url은 소스에 그 개념이 없으면 None(빈 문자열 금지 — 중복 제거·dead_link 분기를 깬다).
    author_id/author_id_kind: strong=고정닉(닉/UID), weak=유동닉 IP 앞 2옥텟, none=식별 불가.
    """

    source: str               # 'dcinside', 'googleplay', ...
    board: str                # 갤러리/앱 패키지/보드 식별자
    post_id: str              # 소스+보드 내 고유 ID
    title: str | None = None
    url: str | None = None
    author: str = ""          # 표시용 닉네임(원문 그대로, 마스킹은 리포트 시점)
    author_id: str | None = None
    author_id_kind: str = "none"
    created_at: str = ""      # 원문 표기 또는 ISO
    views: int = 0
    likes: int = 0
    comment_count: int = 0
    body: str = ""            # 수집 시점 본문 스냅샷
    comments: list[str] = field(default_factory=list)
    rating: int | None = None  # 앱리뷰 별점(1~5), 커뮤니티는 None
    source_ref: str = ""      # url이 없는 소스의 출처 표기(앱 페이지 URL + reviewId 등)
    crawled_at: str = ""

    def __post_init__(self) -> None:
        if self.title == "":
            self.title = None
        if self.url == "":
            self.url = None
        if self.author_id == "":
            self.author_id = None
        if self.author_id_kind not in AUTHOR_ID_KINDS:
            self.author_id_kind = "none"
        if self.author_id is None:
            self.author_id_kind = "none"

    @property
    def key(self) -> str:
        """소스 전체에서 유일한 문자열 키(PainPointer의 Post.id)."""
        return f"{self.source}:{self.board}:{self.post_id}"

    def text_for_analysis(self) -> str:
        """분석에 쓸 합본 텍스트(제목 + 본문 + 댓글)."""
        parts = [self.title, self.body, *self.comments]
        return "\n".join(p for p in parts if p)

    def index_text(self) -> str:
        """FTS 색인 대상(제목 + 본문). 댓글은 다른 작성자의 글이므로 제외."""
        return "\n".join(p for p in (self.title, self.body) if p)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["key"] = self.key
        return d


_YMD_RE = re.compile(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})")
_YY_MD_RE = re.compile(r"^(\d{2})[-./](\d{1,2})[-./](\d{1,2})")
_US_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{2})\(")   # 4chan: 04/25/25(Fri)16:47:07
_MD_RE = re.compile(r"^(\d{1,2})[.](\d{1,2})(?!\d)")
_HM_RE = re.compile(r"^\d{1,2}:\d{2}$")


def parse_day(created_at: str | None, crawled_at: str | None = None) -> str | None:
    """소스별 날짜 표기를 YYYY-MM-DD로. 해석 불가면 None.

    디시 목록은 오늘 글을 "12:34", 올해 글을 "09.17"로 표기하므로 crawled_at로 보정한다.
    """
    if not created_at:
        return None
    s = created_at.strip()
    m = _YMD_RE.search(s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return _fmt(y, mo, d)
    m = _US_RE.match(s)
    if m:
        mo, d, y = (int(x) for x in m.groups())
        return _fmt(2000 + y, mo, d)
    m = _YY_MD_RE.match(s)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return _fmt(2000 + y, mo, d)
    base = _crawl_date(crawled_at)
    m = _MD_RE.match(s)
    if m and base:
        mo, d = int(m.group(1)), int(m.group(2))
        y = base.year
        if (mo, d) > (base.month, base.day):
            y -= 1  # 연초에 수집한 작년 12월 글
        return _fmt(y, mo, d)
    if _HM_RE.match(s) and base:
        return base.strftime("%Y-%m-%d")
    return None


def _fmt(y: int, mo: int, d: int) -> str | None:
    try:
        return datetime(y, mo, d).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _crawl_date(crawled_at: str | None) -> datetime | None:
    if not crawled_at:
        return None
    m = _YMD_RE.search(crawled_at)
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    try:
        dt = datetime(y, mo, d)
    except ValueError:
        return None
    # crawled_at은 UTC ISO. 한국 시간 기준 날짜로 보정(+9h, 날짜만 쓰므로 근사).
    hm = re.search(r"T(\d{2}):(\d{2})", crawled_at)
    if hm:
        dt = dt + timedelta(hours=int(hm.group(1)), minutes=int(hm.group(2))) + timedelta(hours=9)
    return dt


@dataclass
class CrawlResult:
    source: str
    board: str
    start_page: int
    end_page: int
    posts: list[Post] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "board": self.board,
            "start_page": self.start_page,
            "end_page": self.end_page,
            "count": len(self.posts),
            "posts": [p.to_dict() for p in self.posts],
        }
