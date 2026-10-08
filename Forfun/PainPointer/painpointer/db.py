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
SCHEMA_VERSION = 4   # v2: 임베딩 테이블 PK에 model 포함 / v3: llm_calls.scope(예산 범위) + budget_reservations
                     # v4: extract_embeddings(불편 추출 문장 임베딩 캐시)

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
        ts TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'report'
    )""",
    "CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls(ts)",
    # 호출 직전 예산 예약. (지출 + 유효 예약 + 이번 견적) ≤ 상한일 때만 넣는다. 완료 시 llm_calls 행과 맞바꾼다.
    """CREATE TABLE IF NOT EXISTS budget_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        est_usd REAL NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    )""",
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
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        year INTEGER,
        source TEXT NOT NULL,
        url TEXT,
        result TEXT,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (project_id, model)
    )""",
    # 페인 지도(발견 모드): 글별 불편 추출 캐시. 타깃·질의와 무관하게 글 단위로 재사용한다.
    """CREATE TABLE IF NOT EXISTS pain_extracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_key TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        pain TEXT NOT NULL DEFAULT '',
        intensity INTEGER NOT NULL DEFAULT 0,
        quote TEXT NOT NULL DEFAULT '',
        injection_flag INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (post_key, prompt_hash, model)
    )""",
    """CREATE TABLE IF NOT EXISTS pain_maps (
        id TEXT PRIMARY KEY,
        boards_json TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        since TEXT NOT NULL,
        map_json TEXT NOT NULL,
        html TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS post_embeddings (
        post_key TEXT NOT NULL,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (post_key, model)
    )""",
    # 불편 추출 문장 임베딩 캐시(의미 검색). text_sha가 현재 추출 문장과 다르면(다른 LLM 모델이 다시 추출) 없는 것으로 본다.
    """CREATE TABLE IF NOT EXISTS extract_embeddings (
        post_key TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text_sha TEXT NOT NULL,
        vector BLOB NOT NULL,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (post_key, prompt_hash, model)
    )""",
]

# v1 → v2: 단일 키 PK였던 임베딩 테이블을 (키, model) PK로 다시 만든다. 행은 그대로 옮긴다.
_PK_MIGRATIONS = {
    "post_embeddings": ("post_key", "post_key, vector, model, computed_at"),
    "attempt_embeddings": ("project_id", "project_id, title, year, source, url, result, vector, model, computed_at"),
}


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    have = {r[1] for r in conn.execute("PRAGMA table_info(llm_calls)")}
    if "scope" not in have:
        conn.execute("ALTER TABLE llm_calls ADD COLUMN scope TEXT NOT NULL DEFAULT 'report'")


def _pk_cols(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [r[1] for r in sorted((r for r in rows if r[5]), key=lambda r: r[5])]


def _migrate_embedding_pk(conn: sqlite3.Connection) -> None:
    ddl = {t: next(d for d in _DDL if f"EXISTS {t} (" in d) for t in _PK_MIGRATIONS}
    todo = [t for t, (key, _) in _PK_MIGRATIONS.items() if _pk_cols(conn, t) == [key]]
    if not todo:
        return
    conn.commit()
    conn.execute("BEGIN IMMEDIATE")   # 이름 바꾸기~복사~삭제를 한 트랜잭션으로(중간에 끊겨도 v1 그대로)
    try:
        for table in todo:
            cols = _PK_MIGRATIONS[table][1]
            conn.execute(f"ALTER TABLE {table} RENAME TO {table}_v1")
            conn.execute(ddl[table])
            conn.execute(f"INSERT INTO {table}({cols}) SELECT {cols} FROM {table}_v1")
            conn.execute(f"DROP TABLE {table}_v1")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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
        _add_missing_columns(conn)
        _migrate_embedding_pk(conn)
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
