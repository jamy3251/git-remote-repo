import json
import sqlite3

import pytest

from dccrawler.models import Post
from dccrawler.storage import SCHEMA_VERSION, SchemaOutdated, Store, get_version, migrate


def _v1_db(path, rows):
    conn = sqlite3.connect(str(path))
    conn.execute(
        """CREATE TABLE posts (
            source TEXT NOT NULL, board TEXT NOT NULL, post_id TEXT NOT NULL,
            title TEXT, url TEXT, author TEXT, created_at TEXT,
            views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, comment_count INTEGER DEFAULT 0,
            body TEXT, comments TEXT, crawled_at TEXT,
            PRIMARY KEY (source, board, post_id))"""
    )
    conn.executemany("INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()


def test_fresh_db_is_v2(tmp_path):
    st = Store(tmp_path / "new.db")
    assert get_version(st.conn) == SCHEMA_VERSION
    assert st.conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    st.close()


def test_v1_store_refuses_without_migrate(tmp_path):
    db = tmp_path / "old.db"
    _v1_db(db, [("dcinside", "g", "1", "", "", "", "2026-09-01", 0, 0, 0, "본문", "[]", "")])
    with pytest.raises(SchemaOutdated):
        Store(db)


def test_migrate_v1_idempotent_and_backfills(tmp_path):
    db = tmp_path / "old.db"
    _v1_db(db, [
        ("dcinside", "g", "1", "", "", "", "2026-09-01 10:00:00", 3, 1, 2, "배달이 늦어요", "[]", "2026-09-02T00:00:00+00:00"),
        ("natepann", "talk", "7", "제목", "https://x/7", "익명", "09.17", 0, 0, 0, "", '["댓글"]', "2026-09-20T01:00:00+00:00"),
    ])
    info = migrate(db, log=lambda *_: None)
    assert info["from"] == 1 and info["to"] == SCHEMA_VERSION and info["changed"]
    assert info["backup"] and db.with_name(db.name + info["backup"].split(db.name)[-1]).exists()

    info2 = migrate(db, log=lambda *_: None)
    assert info2["changed"] is False

    st = Store(db)
    p = st.get_post("dcinside:g:1")
    assert p.title is None and p.url is None and p.author == ""
    assert p.created_at == "2026-09-01 10:00:00"
    row = st.conn.execute("SELECT created_day, body_hash, tokens, post_key FROM posts WHERE post_key='dcinside:g:1'").fetchone()
    assert row["created_day"] == "2026-09-01"
    assert row["body_hash"] and "배달" in row["tokens"]
    row2 = st.conn.execute("SELECT created_day FROM posts WHERE post_key='natepann:talk:7'").fetchone()
    assert row2["created_day"] == "2026-09-17"
    # FTS 재구축 확인
    assert st.search_keys('"배달"') == ["dcinside:g:1"]
    st.close()


def test_upsert_and_fts_and_readonly(tmp_path):
    db = tmp_path / "pp.db"
    st = Store(db)
    st.upsert_posts([
        Post(source="dcinside", board="g", post_id="1", title="배달 지연 너무 심함", body="한 시간 넘게 기다림",
             author_id="u1", author_id_kind="strong", created_at="2026-08-03 11:00:00"),
        Post(source="googleplay", board="com.app", post_id="r1", body="환불이 안 돼요", rating=1,
             created_at="2026-07-10T00:00:00", source_ref="https://play/x#reviewId=r1"),
        Post(source="dcinside", board="g", post_id="2", title="잡담", body="오늘 날씨 좋다",
             author_id="121.135", author_id_kind="weak", created_at="2026-08-04 11:00:00"),
    ])
    assert st.count() == 3
    assert set(st.search_keys('"배달"')) == {"dcinside:g:1"}
    assert set(st.search_keys('"환불"')) == {"googleplay:com.app:r1"}
    assert st.search_keys('"환불"', sources=["dcinside"]) == []
    assert st.search_keys('"배달"', since_day="2026-09-01") == []

    # 업데이트 시 FTS 동기화
    st.upsert_posts([Post(source="dcinside", board="g", post_id="2", title="잡담", body="배달 얘기로 수정")])
    assert set(st.search_keys('"배달"')) == {"dcinside:g:1", "dcinside:g:2"}
    p2 = st.get_post("dcinside:g:2")
    assert p2.author_id == "121.135" and p2.author_id_kind == "weak"  # 기존 식별자 보존
    st.close()

    ro = Store(db, readonly=True)
    assert ro.count("googleplay") == 1
    with pytest.raises(sqlite3.OperationalError):
        ro.conn.execute("INSERT INTO posts(source,board,post_id,post_key) VALUES('a','b','c','a:b:c')")
    ro.close()


def test_migrate_failure_restores_backup(tmp_path, monkeypatch):
    db = tmp_path / "bad.db"
    _v1_db(db, [("dcinside", "g", "1", "t", "u", "a", "2026-09-01", 0, 0, 0, "b", "[]", "")])
    import dccrawler.storage as storage

    def boom(conn, log):
        raise RuntimeError("boom")

    monkeypatch.setattr(storage, "_migrate_v1_to_v2", boom)
    with pytest.raises(RuntimeError):
        migrate(db, log=lambda *_: None)
    conn = sqlite3.connect(str(db))
    assert conn.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == 1
    assert get_version(conn) is None
    conn.close()
