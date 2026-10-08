"""예산 범위별 합산 + 원자적 예약(레이더 설계 Q1·E2·O2, 작업 T2)."""
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

import pytest

from painpointer import config, db
from painpointer.llm import DailyLimitExceeded, LLM, scope_of_stage

from conftest import MODEL, FakeClient

SCHEMA = {"type": "object", "properties": {"questions": {}}}


def _spend(path, scope, usd, stage="x"):
    """MODEL 가격 (1.0, 5.0) → 입력 100만 토큰 = $1."""
    conn = db.open_write(path)
    with conn:
        conn.execute("INSERT INTO llm_calls(stage, model, prompt_hash, request, status, input_tokens, output_tokens, ts,"
                     " scope) VALUES (?,?,?,?,?,?,?,?,?)",
                     (stage, MODEL, "h", "{}", "ok", int(usd * 1_000_000), 0,
                      datetime.now(timezone.utc).isoformat(timespec="seconds"), scope))
    conn.close()


def _call(llm, stage="expand"):
    return llm.call(stage, MODEL, "s", "u", schema=SCHEMA, prompt_hash="h", max_tokens=10)


def test_stage_scope_mapping():
    assert scope_of_stage("classify") == "report"
    assert scope_of_stage("chat") == "chat"
    assert scope_of_stage("radar_extract") == "radar"
    assert scope_of_stage("diag_layer") == "diag"


def test_two_threads_cannot_both_reserve_the_remaining_budget(tmp_db):
    llm = LLM(tmp_db, budget_usd=0.5)
    barrier = threading.Barrier(2)
    ok, refused = [], []

    def go():
        barrier.wait()
        try:
            ok.append(llm.reserve("report", 0.4))
        except DailyLimitExceeded:
            refused.append(1)
    ts = [threading.Thread(target=go) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(ok) == 1 and len(refused) == 1


def test_call_releases_reservation_and_records_scope(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    _call(llm, "radar_extract")
    conn = sqlite3.connect(tmp_db)
    assert conn.execute("SELECT COUNT(*) FROM budget_reservations").fetchone()[0] == 0
    assert conn.execute("SELECT scope FROM llm_calls").fetchall() == [("radar",)]
    conn.close()


def test_radar_spending_does_not_block_reports(tmp_db, fake_client):
    _spend(tmp_db, "radar", 3.0)
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    _call(llm, "coach")                                    # 리포트 예산은 따로
    with pytest.raises(DailyLimitExceeded, match="radar"):
        _call(llm, "radar_extract")
    assert llm.spent_today("report") < 0.01


def test_promotion_stops_at_two_dollars_and_user_keeps_one(tmp_db, fake_client):
    _spend(tmp_db, "promotion", 2.0)
    promo = LLM(tmp_db, client=fake_client, sleep=lambda *_: None, scope="promotion")
    with pytest.raises(DailyLimitExceeded, match="promotion"):
        _call(promo, "classify")
    user = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    _call(user, "classify")                                # 남은 $1로 사용자 리포트는 돈다
    _spend(tmp_db, "report", 1.0)
    with pytest.raises(DailyLimitExceeded, match="report"):
        _call(user, "classify")                            # report 합계 $3(승격 포함) 도달


def test_chat_has_own_cap_and_call_limit(tmp_db, fake_client, monkeypatch):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    _spend(tmp_db, "chat", 1.0)
    with pytest.raises(DailyLimitExceeded, match="chat"):
        _call(llm, "chat")
    _call(llm, "radar_extract")                            # 대화 소진이 레이더 나머지를 막지 않음($1 < $3)
    monkeypatch.setattr(config, "BUDGET_CHAT_USD", 5.0)
    monkeypatch.setattr(config, "RADAR_BUDGET_USD", 10.0)
    monkeypatch.setattr(config, "CHAT_CALL_LIMIT", 2)
    _call(llm, "chat")                                     # chat 행 2개(기존 1 + 이번 1)
    with pytest.raises(DailyLimitExceeded, match="대화 호출 한도"):
        _call(llm, "chat")


def test_expired_reservations_do_not_hold_budget(tmp_db, fake_client):
    conn = db.open_write(tmp_db)
    past = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat(timespec="seconds")
    with conn:
        conn.execute("INSERT INTO budget_reservations(scope, est_usd, created_at, expires_at) VALUES ('report', 2.99, ?, ?)",
                     (past, past))
    conn.close()
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    _call(llm)                                             # 죽은 프로세스의 예약은 10분 뒤 무시


def test_unrecorded_calls_in_jsonl_count_toward_budget(tmp_db, fake_client):
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    rec = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "event": "llm_call", "stage": "classify",
           "model": MODEL, "status": "ok", "scope": "report", "record_error": "OperationalError: database is locked",
           "in_tok": 3_000_000, "out_tok": 0}
    (config.LOG_DIR / (datetime.now().strftime("%Y-%m-%d") + ".jsonl")).write_text(
        json.dumps(rec) + "\n", encoding="utf-8")
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    assert llm.spent_today() == pytest.approx(3.0)
    with pytest.raises(DailyLimitExceeded):
        _call(llm)


def test_each_retry_attempt_is_reserved(tmp_db):
    """첫 시도가 과금된 실패(출력 오류)로 예산을 다 쓰면 두 번째 시도는 예약 단계에서 막힌다."""
    c = FakeClient()
    orig = c.messages.create

    def create(**req):
        r = orig(**req)
        r.content[0].text = "not json"
        r.usage.input_tokens = 2_000_000                   # $2 청구
        return r
    c.messages.create = create
    llm = LLM(tmp_db, client=c, sleep=lambda *_: None, budget_usd=2.5)   # 시도당 견적 $0.6(출력 12만 토큰)
    with pytest.raises(DailyLimitExceeded):
        llm.call("coach", MODEL, "s", "u", schema=SCHEMA, prompt_hash="h", max_tokens=120_000, retries=3)
    assert len(c.calls) == 1


def test_old_llm_calls_table_gets_scope_column(tmp_path):
    p = tmp_path / "old.db"
    db.init_db(p)
    conn = sqlite3.connect(p)
    conn.executescript("DROP TABLE llm_calls; CREATE TABLE llm_calls (id INTEGER PRIMARY KEY, job_id TEXT, stage TEXT NOT NULL,"
                       " model TEXT NOT NULL, response_model TEXT, prompt_hash TEXT NOT NULL, request TEXT NOT NULL,"
                       " response TEXT, status TEXT NOT NULL, error TEXT, elapsed_ms INTEGER, input_tokens INTEGER,"
                       " output_tokens INTEGER, ts TEXT NOT NULL);"
                       "INSERT INTO llm_calls(stage, model, prompt_hash, request, status, ts) VALUES ('coach','m','h','{}','ok','t');")
    conn.close()
    db.init_db(p)
    conn = sqlite3.connect(p)
    assert conn.execute("SELECT scope FROM llm_calls").fetchall() == [("report",)]
    conn.close()


# ---- 외부 문서 단계 요청 축약 기록(T3, eng review D12) ----
DOC_BODY = "이 초록은 저장되면 안 되는 외부 원문 문장입니다. Federated learning on edge devices."


def test_external_doc_stage_stores_hash_not_text(tmp_db, fake_client):
    import hashlib
    from painpointer.llm import redact_docs
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    user = f'<doc id="oa:W1" url="https://openalex.org/W1">{DOC_BODY}</doc>\n<doc id="g:2">둘째 기사</doc>'
    llm.call("radar_extract", MODEL, "s", user, schema=SCHEMA, prompt_hash="h", max_tokens=10)
    assert DOC_BODY in fake_client.calls[-1]["messages"][0]["content"]   # 모델에는 원문을 보낸다
    conn = sqlite3.connect(tmp_db)
    stored = conn.execute("SELECT request FROM llm_calls").fetchone()[0]
    conn.close()
    assert DOC_BODY not in stored and "둘째 기사" not in stored
    h = hashlib.sha256(DOC_BODY.encode("utf-8")).hexdigest()
    assert f"sha256:{h} len:{len(DOC_BODY)} url:https://openalex.org/W1" in stored
    assert "oa:W1" in stored                                           # 증거 id는 남는다
    assert redact_docs("문서 없음") == "문서 없음"


def test_community_stage_keeps_full_request(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    llm.call("coach", MODEL, "s", f"<doc id='p1'>{DOC_BODY}</doc>", schema=SCHEMA, prompt_hash="h", max_tokens=10)
    conn = sqlite3.connect(tmp_db)
    assert DOC_BODY in conn.execute("SELECT request FROM llm_calls").fetchone()[0]
    conn.close()
