"""레이더 저장소 data/radar.db (eng review D8: painpointer.db와 분리).

- 레이더 배치·대화·화면 기록은 전부 이 파일에 쓴다. painpointer.db는 posts·리포트 조회용으로 읽기 전용으로만 연다
  (db.open_read). llm_calls·예산 판정은 painpointer.db에 그대로 기록된다(llm.LLM).
- 측정값과 AI 산출을 구분해 저장한다: 축 값은 status(measured|unmeasured|hypothesis) + 구조화된 사유,
  AI 판정·생성 행에는 model·prompt_hash를 둔다.
- 증거(evidence)와 카드 버전(card_versions)은 추가만 한다(트리거로 수정·삭제 거부). 대화·착수·반응·비교 기록은
  card_version_id를 참조하므로, 재검증으로 새 버전이 생겨도 과거 기록은 그때의 근거를 그대로 가리킨다.
- schema_version(component='radar').
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from dccrawler.storage import connect, get_version, set_version

from .. import config

COMPONENT = "radar"
SCHEMA_VERSION = 4   # v2: signal_items.injection_flag(guard: 플래그 원천은 카드 근거에서 제외)
                     # v3: radar_fields.definition_json + radar_field_history(분야 정의 이력) + community_fields
                     # v4: topics.keywords_json·radar_extracts.search_en + link_judgments(한계 대응·개선 판정)
                     #     + supply_searches·supply_hits(빈자리 고정 검색 규약 D15)

AXES = ("pain", "incident", "academic", "public", "authority", "maturity", "gap", "novelty")
REASON_CODES = ("waiting", "source_failed", "eval_failed", "untestable", "budget_stopped")

_AXES_SQL = ",".join(f"'{a}'" for a in AXES)
_REASONS_SQL = ",".join(f"'{r}'" for r in REASON_CODES)

_DDL = [
    # ---- 분야·토픽 ----
    """CREATE TABLE IF NOT EXISTS radar_fields (
        id TEXT PRIMARY KEY,                      -- ai, security, hci, telecom, emerging, digital_twin
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        centroid BLOB,                            -- 분야 topic 임베딩 평균(분야 배정 공통 규칙)
        centroid_model TEXT,
        definition_source TEXT,                   -- IT 신기술 정의 출처(L4 목록 또는 L2 상위 10%)
        updated_at TEXT NOT NULL,
        definition_json TEXT NOT NULL DEFAULT '{}' -- 규칙(subfield·키워드·임계)과 근거 수치
    )""",
    # 분야 정의가 바뀔 때마다 이전 정의와 소속 토픽을 남긴다(설계: 정의는 수정 이력을 남긴다)
    """CREATE TABLE IF NOT EXISTS radar_field_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        topic_ids_json TEXT NOT NULL,
        definition_source TEXT,
        changed_at TEXT NOT NULL
    )""",
    # 분야 커뮤니티(묶음 분야 배정 D6): 이 보드 글이 과반이면 그 분야
    """CREATE TABLE IF NOT EXISTS community_fields (
        source TEXT NOT NULL,
        board TEXT NOT NULL,
        field_id TEXT NOT NULL REFERENCES radar_fields(id),
        PRIMARY KEY (source, board)
    )""",
    """CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,                      -- OpenAlex topic id
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        field_id TEXT REFERENCES radar_fields(id),
        updated_at TEXT NOT NULL,
        keywords_json TEXT NOT NULL DEFAULT '[]'  -- OpenAlex 키워드(점수순). 대중 원천 검색어(link.public_terms)
    )""",

    # ---- 신호층(측정) ----
    """CREATE TABLE IF NOT EXISTS signal_items (
        id TEXT PRIMARY KEY,                      -- '<source>:<원천 id>'
        layer INTEGER NOT NULL CHECK (layer BETWEEN 1 AND 5),
        source TEXT NOT NULL,
        kind TEXT NOT NULL,                       -- work, article, story, list_entry, incident, sota, probe ...
        title TEXT NOT NULL DEFAULT '',
        url TEXT,
        published_at TEXT,
        metrics_json TEXT NOT NULL DEFAULT '{}',
        origin TEXT NOT NULL DEFAULT 'batch' CHECK (origin IN ('batch', 'chat')),
        snapshot_date TEXT NOT NULL,
        content_hash TEXT,                        -- 원문은 저장하지 않는다(설계 전문 처리 규칙)
        injection_flag INTEGER NOT NULL DEFAULT 0 -- 원문에 AI를 향한 지시(guard). 카드 근거에서 제외
    )""",
    "CREATE INDEX IF NOT EXISTS idx_signal_layer_source ON signal_items(layer, source, published_at)",
    """CREATE TABLE IF NOT EXISTS topic_series (
        topic_id TEXT NOT NULL,
        layer INTEGER NOT NULL CHECK (layer BETWEEN 1 AND 5),
        metric TEXT NOT NULL,
        period TEXT NOT NULL,                     -- YYYY-MM 또는 YYYY
        value REAL NOT NULL,
        denom REAL,
        denom_kind TEXT NOT NULL CHECK (denom_kind IN ('total', 'self_accumulated', 'none')),
        snapshot_date TEXT NOT NULL,
        PRIMARY KEY (topic_id, layer, metric, period)
    )""",
    """CREATE TABLE IF NOT EXISTS source_freshness (
        source TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'core' CHECK (tier IN ('core', 'optional')),
        latest_data_at TEXT,
        frozen_at TEXT,                           -- 동결 원천(Papers with Code 아카이브 등)
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed', 'no_key', 'disabled')),
        error TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS prestige_venues (
        radar_field_id TEXT NOT NULL REFERENCES radar_fields(id),
        source_id TEXT NOT NULL,
        tier TEXT NOT NULL,
        basis TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        PRIMARY KEY (radar_field_id, source_id)
    )""",

    # ---- 연결층(AI 판정) ----
    """CREATE TABLE IF NOT EXISTS radar_extracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('need', 'capability', 'limit')),
        item_ref TEXT NOT NULL,                   -- signal_items.id 또는 'report:<id>'
        text TEXT NOT NULL,
        quote TEXT NOT NULL DEFAULT '',           -- 120자 이하 인용
        quote_loc TEXT,
        quote_hash TEXT,
        injection_flag INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        search_en TEXT NOT NULL DEFAULT '',       -- 영어 검색 구(OpenAlex 등 영어 원천 질의)
        CHECK (length(quote) <= 120)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_extracts_item ON radar_extracts(item_ref, kind)",
    """CREATE TABLE IF NOT EXISTS topic_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_layer INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        score REAL NOT NULL,
        judgment TEXT NOT NULL CHECK (judgment IN ('yes', 'no')),
        evidence TEXT,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (item_layer, item_id, topic_id, model, prompt_hash)
    )""",
    """CREATE TABLE IF NOT EXISTS incident_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        extract_id INTEGER NOT NULL REFERENCES radar_extracts(id),
        feed TEXT NOT NULL,
        category TEXT NOT NULL,
        score REAL NOT NULL,
        judgment TEXT NOT NULL CHECK (judgment IN ('yes', 'no')),
        evidence TEXT,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (extract_id, feed, category, model, prompt_hash)
    )""",
    """CREATE TABLE IF NOT EXISTS need_capability_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        need_id INTEGER NOT NULL REFERENCES radar_extracts(id),
        capability_id INTEGER NOT NULL REFERENCES radar_extracts(id),
        score REAL,
        judgment TEXT NOT NULL CHECK (judgment IN ('yes', 'no')),
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (need_id, capability_id, model, prompt_hash)
    )""",

    # 한계 문장 판정(왜-지금 D14): edge_limit = 간선 ↔ 그 필요를 막는 한계, limit_benchmark = 한계 ↔ 대응 벤치마크(L5),
    # limit_resolution = 한계 ↔ 그 한계를 해결했다고 주장하는 논문 능력 문장. a_ref·b_ref는 'edge:<id>'·'extract:<id>'·signal id
    """CREATE TABLE IF NOT EXISTS link_judgments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('edge_limit', 'limit_benchmark', 'limit_resolution')),
        a_ref TEXT NOT NULL,
        b_ref TEXT NOT NULL,
        score REAL NOT NULL,
        judgment TEXT NOT NULL CHECK (judgment IN ('yes', 'no')),
        evidence TEXT,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (kind, a_ref, b_ref, model, prompt_hash)
    )""",
    # 빈자리 고정 검색 규약(D15): 원천 5곳 × 질의 3종 × 상위 20. 하나라도 실패하면 status='unmeasured'
    """CREATE TABLE IF NOT EXISTS supply_searches (
        id TEXT PRIMARY KEY,                      -- 질의 3종 + 규약 버전 해시
        need_id INTEGER REFERENCES radar_extracts(id),
        capability_id INTEGER REFERENCES radar_extracts(id),
        queries_json TEXT NOT NULL,
        protocol_json TEXT NOT NULL,              -- 원천 목록·깊이·원천별 임계·중복 임계·임베딩 모델
        status TEXT NOT NULL CHECK (status IN ('measured', 'unmeasured')),
        sources_json TEXT NOT NULL,               -- {원천: {status, n_hits, n_similar, error}}
        gap_count INTEGER,                        -- 중복 제거 후 유사 항목 총수(measured만)
        searched_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS supply_hits (
        search_id TEXT NOT NULL REFERENCES supply_searches(id),
        source TEXT NOT NULL,
        item_key TEXT NOT NULL,
        title TEXT NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',         -- 제목 + 요약 앞부분(≤300자, 참신성 계산용)
        url TEXT,
        score REAL NOT NULL,                      -- 질의 3종과의 최대 cosine
        similar INTEGER NOT NULL,                 -- 원천별 임계 이상
        dup_of TEXT,                              -- 원천 간 중복이면 대표 항목 '<source>:<item_key>'
        PRIMARY KEY (search_id, source, item_key)
    )""",

    # ---- 증거 저장소(추가만) ----
    """CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,                      -- 카드·대화가 인용하는 id
        kind TEXT NOT NULL CHECK (kind IN ('signal', 'extract', 'report', 'edge', 'probe', 'dataset_check', 'search')),
        ref_id TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        url TEXT,
        snapshot_date TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
        BEGIN SELECT RAISE(ABORT, 'evidence는 추가만 합니다'); END""",
    """CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
        BEGIN SELECT RAISE(ABORT, 'evidence는 추가만 합니다'); END""",

    # ---- 생성층 ----
    """CREATE TABLE IF NOT EXISTS operators (
        id TEXT PRIMARY KEY,
        family TEXT NOT NULL CHECK (family IN ('SIT', 'TRIZ', 'Boden', 'SCAMPER')),
        name TEXT NOT NULL,
        definition TEXT NOT NULL,
        examples_json TEXT NOT NULL DEFAULT '[]',  -- '재구성' 예시(성공·실패)
        n_success INTEGER NOT NULL DEFAULT 0,
        n_failure INTEGER NOT NULL DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS promotion_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster_key TEXT NOT NULL,                -- 지도 묶음 대표 문장 해시(재군집에도 동일성 유지)
        pain TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        pool TEXT NOT NULL,                       -- 분야 id 또는 'unassigned'
        priority REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued'
            CHECK (status IN ('queued', 'running', 'passed', 'failed_gate', 'error')),
        report_id TEXT,                           -- painpointer.db reports.id
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        enqueued_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (cluster_key)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_promotion_status ON promotion_queue(status, priority)",
    """CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('paper', 'startup')),
        field_id TEXT,                            -- NULL = 분야 미정
        operator_id TEXT REFERENCES operators(id),
        edge_id INTEGER REFERENCES need_capability_edges(id),
        pain_report_id TEXT,
        parent_card_id TEXT REFERENCES cards(id), -- 좁히기·결합·변이의 원본
        generation INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'candidate'
            CHECK (status IN ('candidate', 'archived', 'held', 'rejected')),
        hold_reason TEXT CHECK (hold_reason IS NULL OR hold_reason IN
            ('few_axes', 'whynow_unmeasured', 'field_unassigned', 'pain_unverified', 'duplicate', 'invalid')),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS card_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL REFERENCES cards(id),
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL,          -- 이 버전이 인용한 evidence.id 고정
        snapshot_date TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (card_id, version)
    )""",
    """CREATE TRIGGER IF NOT EXISTS card_versions_no_update BEFORE UPDATE ON card_versions
        BEGIN SELECT RAISE(ABORT, 'card_versions는 추가만 합니다'); END""",
    f"""CREATE TABLE IF NOT EXISTS card_axes (
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        axis TEXT NOT NULL CHECK (axis IN ({_AXES_SQL})),
        status TEXT NOT NULL CHECK (status IN ('measured', 'unmeasured', 'hypothesis')),
        value REAL,
        n INTEGER,
        denom_kind TEXT CHECK (denom_kind IS NULL OR denom_kind IN ('total', 'self_accumulated', 'none')),
        source TEXT,
        snapshot_date TEXT,
        reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ({_REASONS_SQL})),
        source_id TEXT,                           -- 수집 실패 원천
        stage TEXT,                               -- 평가 미통과 단계
        retry_at TEXT,                            -- 대기 다음 실행·예산 재개일
        eval_value REAL,
        eval_threshold REAL,
        PRIMARY KEY (card_version_id, axis),
        CHECK ((status = 'measured' AND value IS NOT NULL AND reason_code IS NULL)
               OR (status = 'unmeasured' AND value IS NULL AND reason_code IS NOT NULL)
               OR status = 'hypothesis')
    )""",
    """CREATE TABLE IF NOT EXISTS card_arm (
        card_id TEXT PRIMARY KEY REFERENCES cards(id),
        arm TEXT NOT NULL CHECK (arm IN ('selector', 'random')),
        operator_id TEXT NOT NULL REFERENCES operators(id)
    )""",
    """CREATE TABLE IF NOT EXISTS archive (
        cell_key TEXT NOT NULL,                   -- 분야|종류|family|왜-지금
        card_id TEXT NOT NULL REFERENCES cards(id),
        rank INTEGER NOT NULL,
        inserted_at TEXT NOT NULL,
        PRIMARY KEY (cell_key, card_id)
    )""",
    """CREATE TABLE IF NOT EXISTS archive_rejections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL REFERENCES cards(id),
        reason TEXT NOT NULL,
        duplicate_of TEXT,
        similarity REAL,
        created_at TEXT NOT NULL
    )""",

    # ---- 같이 고민층(사용자 기록 = 정답 데이터) ----
    """CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        action TEXT CHECK (action IS NULL OR action IN
            ('counter_evidence', 'narrow', 'combine', 'dataset_check', 'probe', 'revalidate', 'free')),
        content TEXT NOT NULL,
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        job_id TEXT,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        reaction TEXT NOT NULL CHECK (reaction IN ('more', 'meh', 'known')),
        context TEXT NOT NULL CHECK (context IN ('list', 'card')),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        decision TEXT NOT NULL CHECK (decision IN ('start', 'hold', 'abandon')),
        reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN
            ('no_data', 'too_big', 'no_interest', 'exists', 'other')),
        memo TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        CHECK (decision = 'start' OR reason_code IS NOT NULL)
    )""",
    """CREATE TABLE IF NOT EXISTS work_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        state TEXT NOT NULL DEFAULT 'in_progress' CHECK (state IN ('in_progress', 'done', 'held', 'abandoned')),
        reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN
            ('no_data', 'too_big', 'no_interest', 'exists', 'other')),
        todo TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '',
        done_criteria TEXT NOT NULL DEFAULT '',
        quit_condition TEXT NOT NULL DEFAULT '',
        artifact_kind TEXT CHECK (artifact_kind IS NULL OR artifact_kind IN ('paper_draft', 'prototype', 'application', 'other')),
        artifact_ref TEXT,
        artifact_ref_kind TEXT CHECK (artifact_ref_kind IS NULL OR artifact_ref_kind IN ('url', 'path', 'text')),
        artifact_found INTEGER,
        memo TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        rev INTEGER NOT NULL DEFAULT 1,
        CHECK (state != 'done' OR (artifact_kind IS NOT NULL AND artifact_ref IS NOT NULL AND artifact_ref != '')),
        CHECK (state NOT IN ('held', 'abandoned') OR reason_code IS NOT NULL)
    )""",
    """CREATE TABLE IF NOT EXISTS work_record_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_record_id INTEGER NOT NULL REFERENCES work_records(id),
        rev INTEGER NOT NULL,
        row_json TEXT NOT NULL,                   -- 바뀌기 전 행 전체
        changed_at TEXT NOT NULL
    )""",
    """CREATE TRIGGER IF NOT EXISTS work_records_history BEFORE UPDATE ON work_records
        BEGIN
            INSERT INTO work_record_history(work_record_id, rev, row_json, changed_at)
            VALUES (OLD.id, OLD.rev, json_object(
                'state', OLD.state, 'reason_code', OLD.reason_code, 'todo', OLD.todo, 'materials', OLD.materials,
                'done_criteria', OLD.done_criteria, 'quit_condition', OLD.quit_condition,
                'artifact_kind', OLD.artifact_kind, 'artifact_ref', OLD.artifact_ref,
                'artifact_ref_kind', OLD.artifact_ref_kind, 'artifact_found', OLD.artifact_found, 'memo', OLD.memo,
                'started_at', OLD.started_at, 'finished_at', OLD.finished_at), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
        END""",
    """CREATE TABLE IF NOT EXISTS comparison_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        left_card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        right_card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        left_arm TEXT NOT NULL CHECK (left_arm IN ('selector', 'random')),
        shown_at TEXT NOT NULL,
        closed_at TEXT,
        CHECK (left_card_version_id != right_card_version_id)
    )""",
    # 열린 쌍은 하나만(새로고침해도 같은 쌍)
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_pair ON comparison_pairs((closed_at IS NULL)) WHERE closed_at IS NULL",
    """CREATE TABLE IF NOT EXISTS comparison_reactions (
        pair_id INTEGER NOT NULL REFERENCES comparison_pairs(id),
        card_version_id INTEGER NOT NULL REFERENCES card_versions(id),
        reaction TEXT NOT NULL CHECK (reaction IN ('more', 'meh', 'known')),
        reacted_at TEXT NOT NULL,
        PRIMARY KEY (pair_id, card_version_id)
    )""",
    """CREATE TRIGGER IF NOT EXISTS comparison_reaction_in_pair BEFORE INSERT ON comparison_reactions
        WHEN NOT EXISTS (SELECT 1 FROM comparison_pairs p WHERE p.id = NEW.pair_id AND p.closed_at IS NULL
                         AND NEW.card_version_id IN (p.left_card_version_id, p.right_card_version_id))
        BEGIN SELECT RAISE(ABORT, '열린 쌍의 카드가 아닙니다'); END""",
    # 두 카드 모두 반응하면 같은 트랜잭션에서 쌍을 닫는다(4-4: 두 칸 모두 반응해야 다음 쌍)
    """CREATE TRIGGER IF NOT EXISTS comparison_pair_close AFTER INSERT ON comparison_reactions
        WHEN (SELECT COUNT(*) FROM comparison_reactions WHERE pair_id = NEW.pair_id) = 2
        BEGIN UPDATE comparison_pairs SET closed_at = NEW.reacted_at WHERE id = NEW.pair_id; END""",
]


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    have = {r[1] for r in conn.execute("PRAGMA table_info(signal_items)")}
    if "injection_flag" not in have:
        conn.execute("ALTER TABLE signal_items ADD COLUMN injection_flag INTEGER NOT NULL DEFAULT 0")
    if "definition_json" not in {r[1] for r in conn.execute("PRAGMA table_info(radar_fields)")}:
        conn.execute("ALTER TABLE radar_fields ADD COLUMN definition_json TEXT NOT NULL DEFAULT '{}'")
    if "keywords_json" not in {r[1] for r in conn.execute("PRAGMA table_info(topics)")}:
        conn.execute("ALTER TABLE topics ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]'")
    if "search_en" not in {r[1] for r in conn.execute("PRAGMA table_info(radar_extracts)")}:
        conn.execute("ALTER TABLE radar_extracts ADD COLUMN search_en TEXT NOT NULL DEFAULT ''")


def init_radar_db(path: str | Path | None = None) -> Path:
    """radar.db 테이블을 만든다. 멱등."""
    path = Path(path or config.RADAR_DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        cur = get_version(conn, COMPONENT)
        for stmt in _DDL:
            conn.execute(stmt)
        _add_missing_columns(conn)
        if cur != SCHEMA_VERSION:
            set_version(conn, SCHEMA_VERSION, COMPONENT)
        conn.commit()
    finally:
        conn.close()
    return path


def open_read(path: str | Path | None = None) -> sqlite3.Connection:
    return connect(Path(path or config.RADAR_DB_PATH), readonly=True)


def open_write(path: str | Path | None = None) -> sqlite3.Connection:
    return connect(Path(path or config.RADAR_DB_PATH))
