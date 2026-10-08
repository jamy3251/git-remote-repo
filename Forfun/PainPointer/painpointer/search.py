"""2단계 search_corpus: 형태소 FTS 검색 (+ 의미 검색) + 중복 제거 3단계.

의미 검색(하이브리드, 2026-10-05): 키워드가 놓치는 구어체 불만("또 내일 발표래")을 줍기 위해
페인 지도가 글마다 추출해 둔 불편 한 문장(pain_extracts)과 페인 문장의 코사인 유사도로 글을 더 가져온다.
가져오기만 한다 — 관련 여부·수치는 키워드 적중과 똑같이 엄격 판정이 정한다(지도 수치는 근거로 쓰지 않음).
글 전체 임베딩은 실측에서 추가 재현율이 0이고 판정 비용만 늘어 쓰지 않는다.

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
    semantic: dict | None = None      # {"keys": [...], "threshold", "pool", "added_raw"} 또는 None(미사용)
    semantic_keys: set[str] = field(default_factory=set)   # 의미 검색으로만 들어온 글(중복 제거 후)

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


def semantic_search(conn, pain_vec, embedder, *, sources: list[str] | None = None, since_day: str | None = None,
                    threshold: float = config.SEMANTIC_THRESHOLD, cap: int = config.SEMANTIC_CAP,
                    db_path=None) -> dict:
    """pain_extracts(글별 최신 추출, 불편 있음)의 문장 ↔ 페인 문장 유사도 ≥ threshold 상위 cap개 글.

    문장 벡터는 extract_embeddings 캐시를 읽고 빠진 것만 인코딩한다(db_path가 있으면 캐시에 넣는다).
    반환 {"keys": [...유사도 내림차순], "threshold", "pool": 후보 추출 문장 수}. 추출 이력이 없으면 pool 0.
    """
    import numpy as np
    from .embed import LATEST_EXTRACTS_SQL, _check_dim, extract_matrix
    sql = LATEST_EXTRACTS_SQL
    args: list = []
    if since_day:
        sql += " AND p.created_day >= ?"
        args.append(since_day)
    if sources:
        sql += " AND p.source IN (%s)" % ",".join("?" * len(sources))
        args += list(sources)
    try:
        rows = [tuple(r) for r in conn.execute(sql, args).fetchall()]
    except Exception:            # pain_extracts 테이블이 없는 옛 DB
        rows = []
    out = {"keys": [], "threshold": threshold, "pool": len(rows)}
    if not rows:
        return out
    M, _ = extract_matrix(conn, rows, embedder, db_path=db_path)
    q = np.asarray(pain_vec, dtype=np.float32)
    _check_dim(M.shape[1], q.shape[0], "extract_embeddings", embedder.model_name)
    q = q / (np.linalg.norm(q) or 1)
    sims = M @ q
    order = [int(j) for j in np.argsort(-sims, kind="stable") if sims[int(j)] >= threshold][:cap]
    out["keys"] = [rows[j][0] for j in order]
    return out


def search_corpus(store: Store, terms: list[str], *, sources: list[str] | None = None,
                  since_day: str | None = None, semantic: dict | None = None) -> SearchResult:
    """semantic: semantic_search() 결과(있으면 키워드 적중과 합친 뒤 한 번에 중복 제거)."""
    match = fts_match(terms)
    kw = set(store.search_keys(match, sources=sources or None, since_day=since_day)) if match else set()
    sem = set(semantic["keys"]) if semantic else set()
    if not kw and not sem:
        return SearchResult(posts=[], n_raw=0, merged={"url": 0, "body": 0, "author_title": 0}, match=match,
                            semantic=semantic and {**semantic, "added_raw": 0})
    keys = sorted(kw | sem)
    posts = load_posts_by_keys(store, keys)
    d = dedup(posts)
    sem_only = {p.key for p in d.posts if p.key in sem and p.key not in kw}
    info = semantic and {k: v for k, v in semantic.items() if k != "keys"} | {"added_raw": len(sem - kw)}
    return SearchResult(posts=d.posts, n_raw=len(keys), merged=d.merged, match=match,
                        semantic=info, semantic_keys=sem_only)
