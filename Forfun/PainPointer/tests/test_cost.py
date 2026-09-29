"""비용 가드: 달러 예산 사전 견적, 가격표 밖 모델 거부, 잘림 무재시도, SDK 재시도 끔, 사고 끔."""
import pytest

from painpointer import config
from painpointer.classify import classify
from painpointer.llm import DailyLimitExceeded, LLM, LLMError, thinking_params
from painpointer.textnorm import query_hash

from conftest import FakeClient, golden_posts, _Resp

PH = query_hash("배달이 늦게 온다", "20대")


def test_budget_estimate_blocks_whole_classify_before_any_call(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, budget_usd=0.0001, sleep=lambda *_: None)
    with pytest.raises(DailyLimitExceeded, match="예산"):
        classify(golden_posts(40), "배달이 늦게 온다", "20대", PH, llm, db_path=tmp_db)
    assert fake_client.calls == []


def test_spent_tokens_count_against_budget(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    classify(golden_posts(10), "배달이 늦게 온다", "20대", PH, llm, db_path=tmp_db)
    spent = llm.spent_today()
    assert spent > 0                                   # 가짜 응답 usage(10/5 토큰) × 가격표
    llm.budget_usd = spent                             # 이미 다 씀 → 다음 호출 거부
    with pytest.raises(DailyLimitExceeded):
        llm.call("expand", config.MODEL_CLASSIFY, "s", "u", schema={"type": "object"}, prompt_hash="h")


def test_unpriced_model_is_refused(tmp_db, fake_client):
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    with pytest.raises(LLMError, match="가격표"):
        llm.call("coach", "claude-fable-5-1", "s", "u", schema={"type": "object"}, prompt_hash="h")
    assert fake_client.calls == []


@pytest.mark.parametrize("stop", ["max_tokens", "refusal"])
def test_truncation_and_refusal_not_retried_but_billed(tmp_db, stop):
    c = FakeClient()
    orig = c.messages.create

    def create(**req):
        r = orig(**req)
        r.stop_reason = stop
        return r
    c.messages.create = create
    llm = LLM(tmp_db, client=c, sleep=lambda *_: None)
    with pytest.raises(LLMError, match="재시도 안 함"):
        llm.call("coach", config.MODEL_COACH, "s", "u", schema={"type": "object", "properties": {"questions": {}}},
                 prompt_hash="h", retries=3)
    assert len(c.calls) == 1
    assert llm.spent_today() > 0                       # 잘린 응답도 과금 → 예산에 반영


def test_sdk_client_retries_disabled(tmp_db, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    llm = LLM(tmp_db)
    assert llm.client.max_retries == 0


def test_thinking_turned_off_for_adaptive_default_models(tmp_db):
    assert thinking_params("claude-haiku-4-5") == {}
    assert thinking_params("claude-sonnet-5") == {"thinking": {"type": "disabled"}}
    assert thinking_params("claude-sonnet-5-5") == {"thinking": {"type": "between_tools"}}


def test_unsupported_schema_constraints_stripped_before_send(tmp_db, fake_client):
    from painpointer.classify import JUDGMENT_SCHEMA
    from painpointer.coach import COACH_SCHEMA
    from painpointer.expand import EXPAND_SCHEMA
    from painpointer.llm import api_schema
    import json
    for sch in (JUDGMENT_SCHEMA, COACH_SCHEMA, EXPAND_SCHEMA):
        sent = json.dumps(api_schema(sch))
        for bad in ("maxItems", "minimum", "maximum", '"minItems": 5', '"minItems": 1'):
            assert bad not in sent or bad == '"minItems": 1'
    llm = LLM(tmp_db, client=fake_client, sleep=lambda *_: None)
    classify(golden_posts(3), "배달이 늦게 온다", "20대", PH, llm, db_path=tmp_db)
    assert "maxItems" not in json.dumps(fake_client.calls[0]["output_config"])
