"""SQLite 기반 글 저장소 + 스키마 버전/마이그레이션 + 형태소 FTS 색인.

스키마 v2 (PainPointer 공용):
- posts: id INTEGER PK + UNIQUE(source, board, post_id) + post_key
         + author_id/author_id_kind, rating, source_ref, body_hash, created_day, tokens, norm_version
- posts_fts: FTS5(tokens) external-content, 트리거로 동기화
- schema_version(component, version, migrated_at)
- WAL 모드 + busy_timeout 5초

v1(구 DCCrawler) → v2 마이그레이션은 `python -m dccrawler migrate [--db PATH]`.
자동 백업(.bak-타임스탬프) 후 트랜잭션 안에서 진행, 실패 시 롤백.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Post, parse_day
from .textnorm import NORM_VERSION, text_hash, tokens_text

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "dccrawler.db"
COMPONENT = "dccrawler"
SCHEMA_VERSION = 2
BUSY_TIMEOUT_MS = 5000


class SchemaOutdated(RuntimeError):
    """DB 스키마가 코드보다 오래됨. `python -m dccrawler migrate --db PATH` 필요."""


class SchemaTooNew(RuntimeError):
    """DB 스키마가 코드보다 새로움(코드 업데이트 필요)."""


def connect(db_path: str | Path, *, readonly: bool = False) -> sqlite3.Connection:
    """WAL + busy_timeout이 설정된 연결. readonly=True면 쓰기 시도 자체가 실패한다."""
    db_path = Path(db_path)
    if readonly:
        uri = f"file:///{db_path.resolve().as_posix().lstrip('/')}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=BUSY_TIMEOUT_MS / 1000)
    else:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path), timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    if not readonly:
        conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?", (name,)
    ).fetchone()
    return row is not None


def get_version(conn: sqlite3.Connection, component: str = COMPONENT) -> int | None:
    """schema_version 테이블의 버전. 테이블이 없으면 None(빈 DB 또는 v1)."""
    if not _table_exists(conn, "schema_version"):
        return None
    row = conn.execute(
        "SELECT version FROM schema_version WHERE component=?", (component,)
    ).fetchone()
    return int(row["version"]) if row else None


def set_version(conn: sqlite3.Connection, version: int, component: str = COMPONENT) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            component   TEXT PRIMARY KEY,
            version     INTEGER NOT NULL,
            migrated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "INSERT INTO schema_version(component, version, migrated_at) VALUES (?,?,?) "
        "ON CONFLICT(component) DO UPDATE SET version=excluded.version, migrated_at=excluded.migrated_at",
        (component, version, datetime.now(timezone.utc).isoformat(timespec="seconds")),
    )


_POSTS_V2 = """
CREATE TABLE IF NOT EXISTS posts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source         TEXT NOT NULL,
    board          TEXT NOT NULL,
    post_id        TEXT NOT NULL,
    post_key       TEXT NOT NULL,
    title          TEXT,
    url            TEXT,
    author         TEXT NOT NULL DEFAULT '',
    author_id      TEXT,
    author_id_kind TEXT NOT NULL DEFAULT 'none',
    created_at     TEXT,
    created_day    TEXT,
    views          INTEGER DEFAULT 0,
    likes          INTEGER DEFAULT 0,
    comment_count  INTEGER DEFAULT 0,
    body           TEXT NOT NULL DEFAULT '',
    comments       TEXT NOT NULL DEFAULT '[]',
    rating         INTEGER,
    source_ref     TEXT NOT NULL DEFAULT '',
    body_hash      TEXT,
    tokens         TEXT NOT NULL DEFAULT '',
    norm_version   TEXT,
    crawled_at     TEXT,
    UNIQUE (source, board, post_id)
)
"""

_INDEXES_V2 = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_key ON posts(post_key)",
    "CREATE INDEX IF NOT EXISTS idx_posts_source_day ON posts(source, created_day)",
    "CREATE INDEX IF NOT EXISTS idx_posts_board_day ON posts(source, board, created_day)",
    "CREATE INDEX IF NOT EXISTS idx_posts_body_hash ON posts(body_hash)",
]

_FTS_V2 = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5("
    "tokens, content='posts', content_rowid='id', tokenize='unicode61')",
    """CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
         INSERT INTO posts_fts(rowid, tokens) VALUES (new.id, new.tokens);
       END""",
    """CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
         INSERT INTO posts_fts(posts_fts, rowid, tokens) VALUES ('delete', old.id, old.tokens);
       END""",
    """CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE OF tokens ON posts BEGIN
         INSERT INTO posts_fts(posts_fts, rowid, tokens) VALUES ('delete', old.id, old.tokens);
         INSERT INTO posts_fts(rowid, tokens) VALUES (new.id, new.tokens);
       END""",
]


def create_schema_v2(conn: sqlite3.Connection) -> None:
    conn.execute(_POSTS_V2)
    for stmt in _INDEXES_V2 + _FTS_V2:
        conn.execute(stmt)
    set_version(conn, SCHEMA_VERSION)


def _derive(p: Post) -> dict:
    """저장 시 계산하는 파생 컬럼."""
    return {
        "post_key": p.key,
        "created_day": parse_day(p.created_at, p.crawled_at),
        "body_hash": text_hash(p.index_text()) if (p.body or p.title) else None,
        "tokens": tokens_text(p.index_text()),
        "norm_version": NORM_VERSION,
    }


def backup_db(db_path: Path) -> Path:
    """온라인 백업 API로 안전하게 복사(WAL 포함 내용 반영). 백업 경로 반환."""
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    dst = db_path.with_name(db_path.name + f".bak-{ts}")
    src = sqlite3.connect(str(db_path))
    try:
        dstc = sqlite3.connect(str(dst))
        try:
            src.backup(dstc)
        finally:
            dstc.close()
    finally:
        src.close()
    return dst


def migrate(db_path: str | Path = DEFAULT_DB, *, log=print) -> dict:
    """멱등 마이그레이션. 반환: {"from": v|None, "to": v, "backup": path|None, "changed": bool}."""
    db_path = Path(db_path)
    exists = db_path.exists()
    conn = connect(db_path)
    try:
        cur = get_version(conn)
        if cur == SCHEMA_VERSION:
            log(f"이미 최신(v{SCHEMA_VERSION}): {db_path}")
            return {"from": cur, "to": SCHEMA_VERSION, "backup": None, "changed": False}
        if cur is not None and cur > SCHEMA_VERSION:
            raise SchemaTooNew(f"DB v{cur} > 코드 v{SCHEMA_VERSION}: {db_path}")
        if not exists or not _table_exists(conn, "posts"):
            create_schema_v2(conn)
            conn.commit()
            log(f"새 DB 생성(v{SCHEMA_VERSION}): {db_path}")
            return {"from": None, "to": SCHEMA_VERSION, "backup": None, "changed": True}
    finally:
        conn.close()

    # v1 → v2: 백업 후 재구성
    backup = backup_db(db_path)
    log(f"백업: {backup}")
    conn = connect(db_path)
    try:
        conn.execute("BEGIN")
        _migrate_v1_to_v2(conn, log)
        set_version(conn, SCHEMA_VERSION)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        log(f"migrate 실패 — 백업에서 복원: {backup}")
        conn.close()
        shutil.copyfile(backup, db_path)
        for suffix in ("-wal", "-shm"):
            p = db_path.with_name(db_path.name + suffix)
            if p.exists():
                p.unlink()
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass
    log(f"마이그레이션 완료: v1 → v{SCHEMA_VERSION}")
    return {"from": 1, "to": SCHEMA_VERSION, "backup": str(backup), "changed": True}


def _migrate_v1_to_v2(conn: sqlite3.Connection, log) -> None:
    conn.execute("ALTER TABLE posts RENAME TO posts_v1")
    conn.execute(_POSTS_V2)
    rows = conn.execute("SELECT * FROM posts_v1").fetchall()
    log(f"v1 글 {len(rows)}건 변환 중…")
    payload = []
    for r in rows:
        p = Post(
            source=r["source"], board=r["board"], post_id=str(r["post_id"]),
            title=r["title"] or None, url=r["url"] or None, author=r["author"] or "",
            created_at=r["created_at"] or "", views=r["views"] or 0, likes=r["likes"] or 0,
            comment_count=r["comment_count"] or 0, body=r["body"] or "",
            comments=json.loads(r["comments"] or "[]"), crawled_at=r["crawled_at"] or "",
        )
        payload.append(_row(p))
    conn.executemany(_INSERT_SQL, payload)
    conn.execute("DROP TABLE posts_v1")
    for stmt in _INDEXES_V2 + _FTS_V2:
        conn.execute(stmt)
    conn.execute("INSERT INTO posts_fts(posts_fts) VALUES ('rebuild')")


_COLS = (
    "source, board, post_id, post_key, title, url, author, author_id, author_id_kind, "
    "created_at, created_day, views, likes, comment_count, body, comments, rating, "
    "source_ref, body_hash, tokens, norm_version, crawled_at"
)
_INSERT_SQL = f"""
    INSERT INTO posts ({_COLS})
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source, board, post_id) DO UPDATE SET
        title=COALESCE(excluded.title, posts.title),
        url=COALESCE(excluded.url, posts.url),
        author=CASE WHEN excluded.author != '' THEN excluded.author ELSE posts.author END,
        author_id=COALESCE(excluded.author_id, posts.author_id),
        author_id_kind=CASE WHEN excluded.author_id IS NOT NULL THEN excluded.author_id_kind ELSE posts.author_id_kind END,
        created_at=CASE WHEN excluded.created_at != '' THEN excluded.created_at ELSE posts.created_at END,
        created_day=COALESCE(excluded.created_day, posts.created_day),
        views=excluded.views, likes=excluded.likes, comment_count=excluded.comment_count,
        body=CASE WHEN excluded.body != '' THEN excluded.body ELSE posts.body END,
        comments=CASE WHEN excluded.comments != '[]' THEN excluded.comments ELSE posts.comments END,
        rating=COALESCE(excluded.rating, posts.rating),
        source_ref=CASE WHEN excluded.source_ref != '' THEN excluded.source_ref ELSE posts.source_ref END,
        body_hash=CASE WHEN excluded.body != '' OR posts.body = '' THEN excluded.body_hash ELSE posts.body_hash END,
        tokens=CASE WHEN excluded.body != '' OR posts.body = '' THEN excluded.tokens ELSE posts.tokens END,
        norm_version=excluded.norm_version,
        crawled_at=excluded.crawled_at
"""


def _row(p: Post) -> tuple:
    d = _derive(p)
    return (
        p.source, p.board, p.post_id, d["post_key"], p.title, p.url, p.author,
        p.author_id, p.author_id_kind, p.created_at, d["created_day"], p.views, p.likes,
        p.comment_count, p.body, json.dumps(p.comments, ensure_ascii=False), p.rating,
        p.source_ref, d["body_hash"], d["tokens"], d["norm_version"], p.crawled_at,
    )


def row_to_post(r: sqlite3.Row) -> Post:
    return Post(
        source=r["source"], board=r["board"], post_id=r["post_id"],
        title=r["title"], url=r["url"], author=r["author"] or "",
        author_id=r["author_id"], author_id_kind=r["author_id_kind"] or "none",
        created_at=r["created_at"] or "", views=r["views"] or 0,
        likes=r["likes"] or 0, comment_count=r["comment_count"] or 0,
        body=r["body"] or "", comments=json.loads(r["comments"] or "[]"),
        rating=r["rating"], source_ref=r["source_ref"] or "",
        crawled_at=r["crawled_at"] or "",
    )


class Store:
    """글 저장소. 시작 시 스키마 버전을 확인한다.

    - 빈 DB: v2 스키마를 만든다.
    - v1 DB: SchemaOutdated (auto_migrate=True면 migrate() 실행).
    - readonly=True: 읽기 전용 연결(리포트 생성 경로).
    """

    def __init__(self, db_path: str | Path = DEFAULT_DB, *, auto_migrate: bool = False,
                 readonly: bool = False):
        self.db_path = Path(db_path)
        if not readonly:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = connect(self.db_path, readonly=readonly)
        self.readonly = readonly
        self._check_schema(auto_migrate)

    def _check_schema(self, auto_migrate: bool) -> None:
        ver = get_version(self.conn)
        if ver == SCHEMA_VERSION:
            return
        if ver is not None and ver > SCHEMA_VERSION:
            raise SchemaTooNew(f"DB v{ver} > 코드 v{SCHEMA_VERSION}: {self.db_path}")
        if self.readonly:
            raise SchemaOutdated(
                f"{self.db_path}: 스키마 v{ver or 1} (필요 v{SCHEMA_VERSION}). "
                f"`python -m dccrawler migrate --db {self.db_path}`를 먼저 실행하세요."
            )
        if ver is None and not _table_exists(self.conn, "posts"):
            create_schema_v2(self.conn)
            self.conn.commit()
            return
        if auto_migrate:
            self.conn.close()
            migrate(self.db_path, log=lambda *_: None)
            self.conn = connect(self.db_path)
            return
        raise SchemaOutdated(
            f"{self.db_path}: 스키마 v{ver or 1} (필요 v{SCHEMA_VERSION}). "
            f"`python -m dccrawler migrate --db {self.db_path}`를 먼저 실행하세요."
        )

    # ---- 쓰기 ----
    def upsert_posts(self, posts: list[Post]) -> int:
        if not posts:
            return 0
        rows = [_row(p) for p in posts]
        with self.conn:
            self.conn.executemany(_INSERT_SQL, rows)
        return len(rows)

    # ---- 읽기 ----
    def load_posts(self, source: str, board: str) -> list[Post]:
        cur = self.conn.execute(
            "SELECT * FROM posts WHERE source=? AND board=? ORDER BY created_day DESC, id DESC",
            (source, board),
        )
        return [row_to_post(r) for r in cur.fetchall()]

    def get_post(self, post_key: str) -> Post | None:
        r = self.conn.execute("SELECT * FROM posts WHERE post_key=?", (post_key,)).fetchone()
        return row_to_post(r) if r else None

    def count(self, source: str | None = None, board: str | None = None) -> int:
        sql, args = "SELECT COUNT(*) FROM posts", []
        conds = []
        if source:
            conds.append("source=?"); args.append(source)
        if board:
            conds.append("board=?"); args.append(board)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        return int(self.conn.execute(sql, args).fetchone()[0])

    def latest_day(self, source: str, board: str) -> str | None:
        r = self.conn.execute(
            "SELECT MAX(created_day) AS d FROM posts WHERE source=? AND board=?", (source, board)
        ).fetchone()
        return r["d"] if r and r["d"] else None

    def search_keys(self, match: str, *, sources: list[str] | None = None,
                    since_day: str | None = None) -> list[str]:
        """FTS MATCH 식으로 post_key 목록(중복 제거 전)."""
        sql = (
            "SELECT p.post_key FROM posts_fts f JOIN posts p ON p.id = f.rowid "
            "WHERE posts_fts MATCH ?"
        )
        args: list = [match]
        if sources:
            sql += " AND p.source IN (%s)" % ",".join("?" * len(sources))
            args.extend(sources)
        if since_day:
            sql += " AND p.created_day >= ?"
            args.append(since_day)
        return [r["post_key"] for r in self.conn.execute(sql, args).fetchall()]

    def close(self) -> None:
        self.conn.close()
