"""레이더 저장소(T4 + RT3): 분리된 radar.db, 동시 실행, 추가 전용 증거·카드 버전, 축 사유, 착수 기록, 비교 쌍."""
import json
import sqlite3
import threading
import time

import pytest

from painpointer import config
from painpointer.llm import LLM
from painpointer.pipeline import GenerateRequest, generate_report
from painpointer.radar import radar_db
from painpointer.radar.radar_db import AXES, REASON_CODES, init_radar_db

from conftest import TODAY

NOW = "2026-10-09T00:00:00+00:00"


@pytest.fixture
def rdb():
    p = init_radar_db()
    assert p == config.RADAR_DB_PATH
    return p


def _card(conn, card_id="c1", version=1):
    conn.execute("INSERT OR IGNORE INTO cards(id, kind, created_at) VALUES (?, 'paper', ?)", (card_id, NOW))
    cur = conn.execute("INSERT INTO card_versions(card_id, version, body_json, evidence_ids_json, snapshot_date, model,"
                       " prompt_hash, created_at) VALUES (?,?,?,?,?,?,?,?)",
                       (card_id, version, "{}", '["ev1"]', "2026-10-09", "m", "h", NOW))
    return cur.lastrowid


def test_init_is_idempotent_and_separate_file(rdb, tmp_db):
    init_radar_db()
    assert rdb != tmp_db and rdb.exists()
    conn = sqlite3.connect(tmp_db)
    assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='cards'").fetchone()[0] == 0
    conn.close()


def test_report_runs_while_radar_batch_holds_write_lock(rdb, golden_db, fake_client):
    """레이더 배치가 radar.db 쓰기 트랜잭션을 길게 잡고 있어도 리포트 생성(painpointer.db 쓰기)은 성공한다."""
    started, done = threading.Event(), threading.Event()

    def radar_batch():
        conn = radar_db.open_write()
        conn.execute("BEGIN IMMEDIATE")
        for i in range(500):
            conn.execute("INSERT INTO signal_items(id, layer, source, kind, snapshot_date) VALUES (?,2,'openalex','work',?)",
                         (f"openalex:W{i}", "2026-10-09"))
        started.set()
        done.wait(timeout=30)
        conn.commit()
        conn.close()

    t = threading.Thread(target=radar_batch)
    t.start()
    assert started.wait(timeout=10)
    try:
        llm = LLM(golden_db, client=fake_client, sleep=lambda *_: None)
        req = GenerateRequest(pain="배달이 늦게 온다", target="20대", terms=["배달 지연", "배달"], generated_terms=["배달 지연"])
        t0 = time.perf_counter()
        report, _ = generate_report(req, db_path=golden_db, llm=llm, embedder=None, today=TODAY)
        assert report.id and time.perf_counter() - t0 < 30
    finally:
        done.set()
        t.join()
    conn = radar_db.open_read()
    assert conn.execute("SELECT COUNT(*) FROM signal_items").fetchone()[0] == 500
    conn.close()


def test_evidence_and_card_versions_are_append_only(rdb):
    conn = radar_db.open_write()
    with conn:
        conn.execute("INSERT INTO evidence(id, kind, ref_id, snapshot_date, created_at) VALUES ('ev1','signal','s1','d',?)", (NOW,))
        cv = _card(conn)
    for sql in ("UPDATE evidence SET summary='x' WHERE id='ev1'", "DELETE FROM evidence WHERE id='ev1'",
                f"UPDATE card_versions SET body_json='x' WHERE id={cv}"):
        with pytest.raises(sqlite3.IntegrityError, match="추가만"):
            with conn:
                conn.execute(sql)
    conn.close()


def test_axis_status_and_reason_rules(rdb):
    conn = radar_db.open_write()
    with conn:
        cv = _card(conn)
        conn.execute("INSERT INTO card_axes(card_version_id, axis, status, value, n, denom_kind) VALUES (?,'pain','measured',34,34,'total')", (cv,))
        conn.execute("INSERT INTO card_axes(card_version_id, axis, status, reason_code, stage, eval_value, eval_threshold)"
                     " VALUES (?,'academic','unmeasured','eval_failed','edge',0.72,0.8)", (cv,))
        conn.execute("INSERT INTO card_axes(card_version_id, axis, status, reason_code, retry_at)"
                     " VALUES (?,'public','unmeasured','budget_stopped','2026-10-10')", (cv,))
    bad = [
        "INSERT INTO card_axes(card_version_id, axis, status, value, reason_code) VALUES ({cv},'gap','measured',1,'waiting')",
        "INSERT INTO card_axes(card_version_id, axis, status) VALUES ({cv},'novelty','unmeasured')",
        "INSERT INTO card_axes(card_version_id, axis, status, reason_code) VALUES ({cv},'maturity','unmeasured','no_key')",
        "INSERT INTO card_axes(card_version_id, axis, status, value) VALUES ({cv},'feasibility','measured',3)",
    ]
    for sql in bad:
        with pytest.raises(sqlite3.IntegrityError):
            with conn:
                conn.execute(sql.format(cv=cv))
    conn.close()
    assert len(AXES) == 8 and len(REASON_CODES) == 5      # 화면 2-2 사유 5종과 1:1


def test_work_record_requires_artifact_to_finish_and_keeps_history(rdb):
    conn = radar_db.open_write()
    with conn:
        cv = _card(conn)
        wid = conn.execute("INSERT INTO work_records(card_version_id, todo, started_at) VALUES (?, '초안 1쪽', ?)",
                           (cv, NOW)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):
        with conn:
            conn.execute("UPDATE work_records SET state='done', rev=rev+1 WHERE id=?", (wid,))
    with pytest.raises(sqlite3.IntegrityError):
        with conn:
            conn.execute("UPDATE work_records SET state='abandoned', rev=rev+1 WHERE id=?", (wid,))
    with conn:
        conn.execute("UPDATE work_records SET state='done', artifact_kind='paper_draft', artifact_ref='https://x/doc',"
                     " artifact_ref_kind='url', finished_at=?, rev=rev+1 WHERE id=?", (NOW, wid))
    hist = conn.execute("SELECT rev, row_json FROM work_record_history WHERE work_record_id=?", (wid,)).fetchall()
    assert [h["rev"] for h in hist] == [1]
    assert json.loads(hist[0]["row_json"])["state"] == "in_progress" and json.loads(hist[0]["row_json"])["todo"] == "초안 1쪽"
    conn.close()


def test_comparison_pair_closes_only_after_both_reactions(rdb):
    conn = radar_db.open_write()
    with conn:
        a, b, other = _card(conn, "ca"), _card(conn, "cb"), _card(conn, "cc")
        pid = conn.execute("INSERT INTO comparison_pairs(left_card_version_id, right_card_version_id, left_arm, shown_at)"
                           " VALUES (?,?, 'random', ?)", (a, b, NOW)).lastrowid
    with pytest.raises(sqlite3.IntegrityError):            # 열린 쌍은 하나만
        with conn:
            conn.execute("INSERT INTO comparison_pairs(left_card_version_id, right_card_version_id, left_arm, shown_at)"
                         " VALUES (?,?, 'selector', ?)", (a, other, NOW))
    with pytest.raises(sqlite3.IntegrityError, match="열린 쌍"):
        with conn:
            conn.execute("INSERT INTO comparison_reactions VALUES (?,?, 'more', ?)", (pid, other, NOW))
    with conn:
        conn.execute("INSERT INTO comparison_reactions VALUES (?,?, 'more', ?)", (pid, a, NOW))
    assert conn.execute("SELECT closed_at FROM comparison_pairs WHERE id=?", (pid,)).fetchone()[0] is None
    with pytest.raises(sqlite3.IntegrityError):            # 같은 카드 중복 반응(두 탭)
        with conn:
            conn.execute("INSERT INTO comparison_reactions VALUES (?,?, 'meh', ?)", (pid, a, NOW))
    with conn:
        conn.execute("INSERT INTO comparison_reactions VALUES (?,?, 'known', ?)", (pid, b, NOW))
    assert conn.execute("SELECT closed_at FROM comparison_pairs WHERE id=?", (pid,)).fetchone()[0] == NOW
    with conn:                                             # 닫힌 뒤 다음 쌍
        conn.execute("INSERT INTO comparison_pairs(left_card_version_id, right_card_version_id, left_arm, shown_at)"
                     " VALUES (?,?, 'selector', ?)", (a, other, NOW))
    conn.close()


def test_decision_needs_reason_unless_start(rdb):
    conn = radar_db.open_write()
    with conn:
        cv = _card(conn)
        conn.execute("INSERT INTO decisions(card_version_id, decision, created_at) VALUES (?, 'start', ?)", (cv, NOW))
        conn.execute("INSERT INTO decisions(card_version_id, decision, reason_code, created_at) VALUES (?, 'hold', 'too_big', ?)", (cv, NOW))
    with pytest.raises(sqlite3.IntegrityError):
        with conn:
            conn.execute("INSERT INTO decisions(card_version_id, decision, created_at) VALUES (?, 'abandon', ?)", (cv, NOW))
    conn.close()
