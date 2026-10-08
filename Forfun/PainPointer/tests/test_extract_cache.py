"""불편 추출 문장 임베딩 캐시(T6, eng review D11): 배치가 미리 계산, 의미 검색은 캐시를 읽고 빠진 것만 인코딩."""
from datetime import date

import numpy as np

from painpointer import db
from painpointer.discover import DiscoverRequest, discover
from painpointer.embed import (LATEST_EXTRACTS_SQL, HashEmbedder, embed_missing_extracts, load_extract_embeddings,
                               reembed)
from painpointer.llm import LLM
from painpointer.search import semantic_search

from conftest import TODAY

PAIN = "배달이 늦게 온다"


class CountingEmbedder(HashEmbedder):
    def __init__(self, dim: int = 64):
        super().__init__(dim=dim)
        self.encoded: list[str] = []

    def encode(self, texts):
        self.encoded.extend(texts)
        return super().encode(texts)


class OtherEmbedder(CountingEmbedder):
    def __init__(self):
        super().__init__(dim=32)
        self.model_name = "other-model-test"


def _extracts(golden_db, fake_client):
    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    discover(DiscoverRequest(boards=["dcinside:g1", "googleplay:com.app"], days=400), db_path=golden_db, llm=llm,
             embedder=HashEmbedder(), today=TODAY)


def _search(golden_db, emb, **kw):
    conn = db.open_read(golden_db)
    try:
        q = HashEmbedder(dim=emb.dim).encode([PAIN])[0]
        return semantic_search(conn, q, emb, threshold=0.4, cap=500, **kw)
    finally:
        conn.close()


def _cache_count(golden_db, model="hash-embedder-test"):
    conn = db.open_read(golden_db)
    try:
        return conn.execute("SELECT COUNT(*) FROM extract_embeddings WHERE model=?", (model,)).fetchone()[0]
    finally:
        conn.close()


def test_cached_sentences_are_searched_without_encode_and_same_result(golden_db, fake_client):
    _extracts(golden_db, fake_client)
    cold = CountingEmbedder()
    no_cache = _search(golden_db, cold)                      # 캐시 없음: 풀 전체 인코딩
    assert no_cache["pool"] > 0 and len(cold.encoded) == no_cache["pool"] and no_cache["keys"]
    assert _cache_count(golden_db) == 0                      # db_path 없으면 쓰지 않는다

    assert embed_missing_extracts(golden_db, HashEmbedder()) == no_cache["pool"]
    assert embed_missing_extracts(golden_db, HashEmbedder()) == 0          # 두 번째 배치는 할 일 없음
    warm = CountingEmbedder()
    cached = _search(golden_db, warm)
    assert warm.encoded == []                                # encode 호출 없음
    assert cached == no_cache                                # 결과(순서 포함) 동일


def test_report_encodes_only_missing_and_fills_cache(golden_db, fake_client):
    _extracts(golden_db, fake_client)
    embed_missing_extracts(golden_db, HashEmbedder())
    conn = db.open_write(golden_db)
    with conn:
        victim = conn.execute("SELECT post_key FROM extract_embeddings LIMIT 1").fetchone()[0]
        conn.execute("DELETE FROM extract_embeddings WHERE post_key=?", (victim,))
        pk2 = conn.execute("SELECT post_key FROM extract_embeddings LIMIT 1").fetchone()[0]
        conn.execute("UPDATE pain_extracts SET pain='환불 처리가 일주일 넘게 걸린다' WHERE post_key=?", (pk2,))  # 다시 추출된 문장
    conn.close()
    emb = CountingEmbedder()
    _search(golden_db, emb, db_path=golden_db)
    assert len(emb.encoded) == 2                             # 지운 1건 + 문장이 바뀐 1건만
    assert "환불 처리가 일주일 넘게 걸린다" in emb.encoded            # 문장이 바뀐 캐시는 낡은 것으로 본다
    emb2 = CountingEmbedder()
    _search(golden_db, emb2, db_path=golden_db)
    assert emb2.encoded == []                                # 리포트가 채운 캐시를 다음 리포트가 쓴다


def test_daily_batch_fills_cache_after_extraction(golden_db, fake_client, tmp_path):
    from painpointer.collect_daily import Collector
    _extracts(golden_db, fake_client)
    c = Collector(golden_db, embedder=HashEmbedder(), source_factory=lambda name: None,
                  lock_path=tmp_path / "l", today=date(2026, 9, 21), delay=0)
    c.run()                                                  # 감시 목록이 비어도 추출 문장 캐시는 채운다
    conn = db.open_read(golden_db)
    try:
        n_pool = len(conn.execute(LATEST_EXTRACTS_SQL).fetchall())
    finally:
        conn.close()
    assert n_pool > 0 and _cache_count(golden_db) == n_pool


def test_reembed_covers_extract_cache(golden_db, fake_client):
    _extracts(golden_db, fake_client)
    embed_missing_extracts(golden_db, HashEmbedder())
    n = _cache_count(golden_db)
    other = OtherEmbedder()
    r = reembed(golden_db, other, projects=[])
    assert r["missing"] == 0 and r["extracts"] == n and r["deleted_extracts"] == n
    assert _cache_count(golden_db) == 0 and _cache_count(golden_db, "other-model-test") == n
    conn = db.open_read(golden_db)
    try:
        rows = [tuple(x) for x in conn.execute(LATEST_EXTRACTS_SQL)]
        vecs = load_extract_embeddings(conn, rows, "other-model-test")
        assert len(vecs) == n and {v.shape[0] for v in vecs.values()} == {32}
    finally:
        conn.close()
    after = OtherEmbedder()
    conn = db.open_read(golden_db)
    try:
        semantic_search(conn, np.ones(32, dtype=np.float32), after, threshold=0.0)
    finally:
        conn.close()
    assert after.encoded == []
