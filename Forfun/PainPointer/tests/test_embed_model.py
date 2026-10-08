"""임베딩 모델 범위 지정(eng review D7): (키, model) PK 이전, 모델별 조회, reembed, 차원 불일치 오류."""
import sqlite3

import numpy as np
import pytest

from painpointer import config, db
from painpointer.embed import (EmbeddingMismatch, HashEmbedder, load_post_embeddings, precompute_attempts, reembed,
                               similar_attempts)
from painpointer.llm import LLM
from painpointer.pipeline import GenerateRequest, generate_report

from conftest import TODAY

TERMS = ["배달 지연", "배달 늦음", "늦게 옴", "배달"]
ATTEMPTS = [
    {"id": "a1", "title": "배달 지연 알림 서비스", "text": "배달 지연 늦음 알림", "year": 2024, "source": "hanium_award",
     "url": "u", "result": "대상"},
    {"id": "a2", "title": "주식 분석 도구", "text": "주식 차트 분석", "year": 2023, "source": "hanium_public", "url": "u",
     "result": None},
]


class OtherEmbedder(HashEmbedder):
    """다른 모델(차원 32)로 가장한 가짜 임베더."""

    def __init__(self):
        super().__init__(dim=32)
        self.model_name = "other-model-test"


def _pk(path, table):
    conn = sqlite3.connect(path)
    try:
        return [r[1] for r in sorted((r for r in conn.execute(f"PRAGMA table_info({table})") if r[5]), key=lambda r: r[5])]
    finally:
        conn.close()


def test_v1_schema_migrates_to_model_pk_and_keeps_rows(tmp_path):
    p = tmp_path / "old.db"
    db.init_db(p)
    conn = sqlite3.connect(p)
    # v1 모양으로 되돌린다(단일 키 PK) + 행 1개씩
    conn.executescript("""
        DROP TABLE post_embeddings; DROP TABLE attempt_embeddings;
        CREATE TABLE post_embeddings (post_key TEXT PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL,
            computed_at TEXT NOT NULL);
        CREATE TABLE attempt_embeddings (project_id TEXT PRIMARY KEY, title TEXT NOT NULL, year INTEGER,
            source TEXT NOT NULL, url TEXT, result TEXT, vector BLOB NOT NULL, model TEXT NOT NULL,
            computed_at TEXT NOT NULL);
        INSERT INTO post_embeddings VALUES ('k1', x'0000803f', 'm1', 't');
        INSERT INTO attempt_embeddings VALUES ('a1', 'T', 2024, 's', 'u', NULL, x'0000803f', 'm1', 't');
    """)
    conn.commit()
    conn.close()
    db.init_db(p)
    assert _pk(p, "post_embeddings") == ["post_key", "model"]
    assert _pk(p, "attempt_embeddings") == ["project_id", "model"]
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT post_key, model FROM post_embeddings").fetchall() == [("k1", "m1")]
    assert conn.execute("SELECT project_id, model FROM attempt_embeddings").fetchall() == [("a1", "m1")]
    # 같은 키에 다른 모델 행이 공존할 수 있다
    conn.execute("INSERT INTO post_embeddings VALUES ('k1', x'0000803f', 'm2', 't')")
    conn.commit()
    conn.close()
    db.init_db(p)   # 다시 돌려도 멱등
    assert _pk(p, "post_embeddings") == ["post_key", "model"]


def test_report_uses_only_current_model_rows_when_mixed(golden_db, fake_client):
    precompute_attempts(golden_db, HashEmbedder(), ATTEMPTS)
    precompute_attempts(golden_db, OtherEmbedder(), ATTEMPTS)
    reembed(golden_db, OtherEmbedder(), projects=ATTEMPTS, delete_old=False)   # 교체 진행 중: 두 모델 행 혼재
    conn = db.open_read(golden_db)
    try:
        models = {r[0] for r in conn.execute("SELECT DISTINCT model FROM post_embeddings")}
    finally:
        conn.close()
    assert models == {"hash-embedder-test", "other-model-test"}

    llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
    req = GenerateRequest(pain="배달이 늦게 온다", target="20대 자취생", terms=TERMS, generated_terms=TERMS[:3])
    report, _ = generate_report(req, db_path=golden_db, llm=llm, embedder=HashEmbedder(), today=TODAY)
    assert report.attempts and report.attempts["model"] == "hash-embedder-test"
    assert not any("임베딩 미계산" in d for d in report.degraded)


def test_reembed_fills_new_model_then_deletes_old(golden_db):
    precompute_attempts(golden_db, HashEmbedder(), ATTEMPTS + [
        {"id": "gone", "title": "데이터에서 사라진 과제", "text": "x", "year": 2022, "source": "hanium_public",
         "url": "u", "result": None}])
    r = reembed(golden_db, OtherEmbedder(), projects=ATTEMPTS)
    assert r["missing"] == 0 and r["posts"] > 0 and r["attempts"] == 3   # 사라진 과제는 제목으로 계산
    assert r["deleted_posts"] > 0 and r["deleted_attempts"] == 3
    conn = db.open_read(golden_db)
    try:
        assert {x[0] for x in conn.execute("SELECT DISTINCT model FROM post_embeddings")} == {"other-model-test"}
        assert {x[0] for x in conn.execute("SELECT DISTINCT model FROM attempt_embeddings")} == {"other-model-test"}
        keys = [x[0] for x in conn.execute("SELECT post_key FROM posts LIMIT 5")]
        assert load_post_embeddings(conn, keys) == {}                       # 현재 설정 모델 행은 이제 없음
        assert len(load_post_embeddings(conn, keys, "other-model-test")) == 5
    finally:
        conn.close()


def test_reembed_keeps_old_rows_when_incomplete(golden_db, monkeypatch):
    import painpointer.embed as embed_mod
    monkeypatch.setattr(embed_mod, "embed_missing_posts", lambda *a, **k: 0)   # 글 계산이 중간에 멈춘 상황
    r = reembed(golden_db, OtherEmbedder(), projects=[])
    assert r["missing"] > 0 and r["deleted_posts"] == 0
    conn = db.open_read(golden_db)
    try:
        assert conn.execute("SELECT COUNT(*) FROM post_embeddings WHERE model='hash-embedder-test'").fetchone()[0] > 0
    finally:
        conn.close()


def test_dimension_mismatch_raises_reembed_needed(golden_db):
    precompute_attempts(golden_db, HashEmbedder(), ATTEMPTS)   # 64차원
    conn = db.open_read(golden_db)
    try:
        with pytest.raises(EmbeddingMismatch, match="재임베딩 필요"):
            similar_attempts(conn, np.ones(32, dtype=np.float32), model="hash-embedder-test")
    finally:
        conn.close()
