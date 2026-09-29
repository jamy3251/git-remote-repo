"""PainPointer 테이블(판정 캐시·LLM 로그·리포트·잡·수집 실행·임베딩).

posts/posts_fts는 DCCrawler Store가 소유한다(같은 DB 파일). 이 모듈은 나머지 테이블만 만든다.
- 리포트 생성 경로: posts는 읽기 전용 연결(open_read), judgments/llm_calls/reports는 짧은 쓰기 연결(open_write).
- schema_version(component='painpointer').
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from dccrawler.storage import Store, connect, get_version, set_version

COMPONENT = "painpointer"
SCHEMA_VERSION = 1

_DDL = [
    """CREATE TABLE IF NOT EXISTS judgments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_key TEXT NOT NULL,
        pain_hash TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        relevant INTEGER,
        intensity INTEGER,
        quotes_json TEXT NOT NULL DEFAULT '[]',
        injection_flag INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (post_key, pain_hash, prompt_hash, model)
    )""",
    """CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        stage TEXT NOT NULL,
        model TEXT NOT NULL,
        response_model TEXT,
        prompt_hash TEXT NOT NULL,
        request TEXT NOT NULL,
        response TEXT,
        status TEXT NOT NULL,
        error TEXT,
        elapsed_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        ts TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls(ts)",
    """CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL,
        query_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        html TEXT NOT NULL,
        terms_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        since TEXT NOT NULL,
        created_at TEXT NOT NULL,
        snapshot_date TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_reports_query ON reports(query_hash, created_at)",
    """CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        query_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT,
        progress TEXT,
        error TEXT,
        report_id TEXT,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_jobs_query ON jobs(query_hash, status)",
    """CREATE TABLE IF NOT EXISTS collection_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        board TEXT NOT NULL,
        run_date TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        n_new INTEGER NOT NULL DEFAULT 0,
        missed_from TEXT,
        missed_to TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_runs_source_date ON collection_runs(source, run_date)",
    """CREATE TABLE IF NOT EXISTS watch_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        board TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL,
        UNIQUE (source, board)
    )""",
    """CREATE TABLE IF NOT EXISTS source_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        ref TEXT NOT NULL,
        keyword TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        UNIQUE (kind, ref)
    )""",
    """CREATE TABLE IF NOT EXISTS attempt_embeddings (
        project_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER,
        source TEXT NOT NULL,
        url TEXT,
        result TEXT,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        computed_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS post_embeddings (
        post_key TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        computed_at TEXT NOT NULL
    )""",
]


def init_db(db_path: str | Path) -> Path:
    """posts(DCCrawler v2) + PainPointer 테이블을 만든다. 멱등."""
    db_path = Path(db_path)
    st = Store(db_path, auto_migrate=True)  # posts 스키마 보장
    st.close()
    conn = connect(db_path)
    try:
        cur = get_version(conn, COMPONENT)
        for stmt in _DDL:
            conn.execute(stmt)
        if cur != SCHEMA_VERSION:
            set_version(conn, SCHEMA_VERSION, COMPONENT)
        conn.commit()
    finally:
        conn.close()
    return db_path


def open_read(db_path: str | Path) -> sqlite3.Connection:
    return connect(db_path, readonly=True)


def open_write(db_path: str | Path) -> sqlite3.Connection:
    return connect(db_path)


def is_locked_error(e: Exception) -> bool:
    return isinstance(e, sqlite3.OperationalError) and "locked" in str(e).lower()
