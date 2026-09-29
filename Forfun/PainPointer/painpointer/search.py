"""2단계 search_corpus: 형태소 FTS 검색 + 중복 제거 3단계.

중복 제거(설계 고정):
(1) 동일 URL 제거 → (2) 본문 정규화 해시 동일 시 제거
→ (3) 동일 작성자(strong/weak) + 동일 일자 + 제목 유사도 ≥ 0.9 시 1건 병합(title None이면 건너뜀).
제목 유사도 = difflib.SequenceMatcher(None, a, b).ratio(), NFKC·공백 제거 후.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher

from dccrawler.models import Post
from dccrawler.storage import Store, row_to_post

from . import config
from .textnorm import fts_match, normalize, text_hash

DEDUP_RULES_TEXT = (
    "(1) 동일 URL 제거 → (2) 본문 정규화(NFKC, 공백·특수문자 제거) 해시 동일 시 제거 → "
    "(3) 동일 작성자(strong/weak) + 동일 일자 + 제목 유사도 ≥ 0.9 시 병합(제목 없는 소스는 건너뜀)"
)


@dataclass
class DedupResult:
    posts: list[Post]
    merged: dict[str, int] = field(default_factory=lambda: {"url": 0, "body": 0, "author_title": 0})

    @property
    def merged_total(self) -> int:
        return sum(self.merged.values())


@dataclass
class SearchResult:
    posts: list[Post]
    n_raw: int
    merged: dict[str, int]
    match: str | None

    @property
    def merged_total(self) -> int:
        return sum(self.merged.values())


def load_posts_by_keys(store: Store, keys: list[str]) -> list[Post]:
    out: list[Post] = []
    for i in range(0, len(keys), 500):
        chunk = keys[i:i + 500]
        q = "SELECT * FROM posts WHERE post_key IN (%s) ORDER BY id" % ",".join("?" * len(chunk))
        out.extend(row_to_post(r) for r in store.conn.execute(q, chunk).fetchall())
    return out


def _title_sim(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def dedup(posts: list[Post], title_threshold: float = config.TITLE_SIM_THRESHOLD) -> DedupResult:
    res = DedupResult(posts=[])
    seen_url: set[str] = set()
    seen_hash: set[str] = set()
    kept: list[Post] = []
    # 안정적 순서: created_day 오름차순 → key (같은 입력이면 같은 결과)
    ordered = sorted(posts, key=lambda p: (p.created_at or "", p.key))
    for p in ordered:
        if p.url:
            if p.url in seen_url:
                res.merged["url"] += 1
                continue
            seen_url.add(p.url)
        h = text_hash(p.index_text()) if (p.body or p.title) else None
        if h:
            if h in seen_hash:
                res.merged["body"] += 1
                continue
            seen_hash.add(h)
        kept.append(p)
    # (3) 작성자 + 일자 + 제목 유사도
    from dccrawler.models import parse_day
    groups: dict[tuple[str, str], list[Post]] = {}
    final: list[Post] = []
    for p in kept:
        if p.title is None or p.author_id is None or p.author_id_kind == "none":
            final.append(p)
            continue
        day = parse_day(p.created_at, p.crawled_at) or p.created_at
        g = groups.setdefault((p.author_id, day), [])
        if any(_title_sim(p.title, q.title or "") >= title_threshold for q in g):
            res.merged["author_title"] += 1
            continue
        g.append(p)
        final.append(p)
    res.posts = final
    return res


def search_corpus(store: Store, terms: list[str], *, sources: list[str] | None = None,
                  since_day: str | None = None) -> SearchResult:
    match = fts_match(terms)
    if match is None:
        return SearchResult(posts=[], n_raw=0, merged={"url": 0, "body": 0, "author_title": 0}, match=None)
    keys = store.search_keys(match, sources=sources or None, since_day=since_day)
    keys = sorted(set(keys))
    posts = load_posts_by_keys(store, keys)
    d = dedup(posts)
    return SearchResult(posts=d.posts, n_raw=len(keys), merged=d.merged, match=match)
