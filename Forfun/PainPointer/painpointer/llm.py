"""Anthropic SDK 호출 래퍼.

- 모든 호출은 temperature=0(지원 모델), JSON 스키마 출력(output_config.format), 재시도 N회(지수 백오프).
- 호출마다 llm_calls에 요청·응답·응답 model·토큰·소요시간을 기록한다(리포트 재렌더·감사용).
- 일일 호출 상한(DailyLimitExceeded): 오늘 llm_calls 행 수 ≥ 상한이면 호출 전에 거부.
- 일일 달러 예산(PP_DAILY_BUDGET_USD): 오늘 기록 토큰 × 가격표 + 이번 호출 최대치가 예산을 넘으면 거부.
  가격표(config.PRICES)에 없는 모델은 거부한다. 재시도는 이 래퍼만 한다(SDK max_retries=0) → 모든 시도가 기록·집계된다.
- 잘림(max_tokens)·거절(refusal)은 temperature 0에서 다시 보내도 같으므로 재시도하지 않는다.
- 사고(thinking)가 기본으로 켜지는 모델은 끈다: 짧은 JSON 출력에 사고 토큰이 붙으면 비용이 늘고 max_tokens에 잘린다.
- 테스트는 `client=`로 가짜 클라이언트를 주입한다(같은 인터페이스: .messages.create(...)).
"""
from __future__ import annotations

import json
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic

from . import config, db
from .log import log_event


class LLMError(RuntimeError):
    pass


class DailyLimitExceeded(LLMError):
    pass


class LLMOutputError(LLMError):
    """응답이 JSON이 아니거나 스키마 필수 키가 없음."""


class LLMFinalError(LLMOutputError):
    """재시도해도 같은 결과(잘림·거절)."""


def price_of(model: str) -> tuple[float, float]:
    p = config.PRICES.get(model)
    if p is None:
        raise LLMError(f"가격표에 없는 모델: {model} — config.PRICES에 추가하거나 PP_MODEL_*를 가격표 모델로 바꾸세요")
    return p


def cost_usd(model: str, in_tok: int, out_tok: int) -> float:
    pin, pout = config.PRICES.get(model, (0.0, 0.0))
    return (in_tok * pin + out_tok * pout) / 1_000_000


def estimate_tokens(text: str) -> int:
    """보수적 입력 토큰 추정(한국어는 글자당 약 1토큰 이하)."""
    return len(text)


# 구조화 출력이 거부(400)하는 JSON Schema 제약(2026-09-29 실호출에서 maxItems로 확인).
# 스키마에는 의도 문서로 남기고, 전송 직전에 떼어낸 뒤 개수·범위는 후처리 코드가 강제한다.
_UNSUPPORTED_KEYS = {"maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                     "multipleOf", "minLength", "maxLength"}


def api_schema(schema):
    if isinstance(schema, dict):
        out = {}
        for k, v in schema.items():
            if k in _UNSUPPORTED_KEYS or (k == "minItems" and isinstance(v, int) and v > 1):
                continue
            out[k] = api_schema(v)
        return out
    if isinstance(schema, list):
        return [api_schema(v) for v in schema]
    return schema


def thinking_params(model: str) -> dict:
    """사고를 끄는 요청 필드. Haiku 4.5·구세대는 기본이 사고 없음."""
    m = model or ""
    if "sonnet-5-5" in m:
        return {"thinking": {"type": "between_tools"}}
    if re.search(r"claude-(sonnet-5|opus-5|opus-4-[78])(?!-5)", m):
        return {"thinking": {"type": "disabled"}}
    return {}


# temperature 파라미터를 거부하는(400) 세대. 그 외 모델은 temperature=0을 보낸다.
_NO_TEMPERATURE = re.compile(r"claude-(fable|mythos|opus-5|opus-4-[78]|sonnet-5)")

_RETRYABLE = (
    anthropic.RateLimitError,
    anthropic.APIConnectionError,
    anthropic.APITimeoutError,
    anthropic.InternalServerError,
)


def supports_temperature(model: str) -> bool:
    return not _NO_TEMPERATURE.search(model or "")


class LLM:
    def __init__(self, db_path: str | Path | None = None, *, client=None,
                 daily_limit: int | None = None, budget_usd: float | None = None, sleep=time.sleep):
        self.db_path = Path(db_path or config.DB_PATH)
        self._client = client
        self.daily_limit = config.DAILY_LLM_LIMIT if daily_limit is None else daily_limit
        self.budget_usd = config.DAILY_BUDGET_USD if budget_usd is None else budget_usd
        self._sleep = sleep

    @property
    def client(self):
        if self._client is None:
            self._client = anthropic.Anthropic(max_retries=0, timeout=config.LLM_TIMEOUT_S)
        return self._client

    # ---- 일일 상한 ----
    def calls_today(self) -> int:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        conn = db.open_read(self.db_path)
        try:
            row = conn.execute("SELECT COUNT(*) FROM llm_calls WHERE ts >= ?", (day,)).fetchone()
            return int(row[0])
        finally:
            conn.close()

    def check_daily_limit(self, need: int = 1) -> None:
        used = self.calls_today()
        if used + need > self.daily_limit:
            raise DailyLimitExceeded(
                f"일일 LLM 호출 한도 도달: 오늘 {used}회 + 필요 {need}회 > 상한 {self.daily_limit}회"
            )

    def spent_today(self) -> float:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        conn = db.open_read(self.db_path)
        try:
            rows = conn.execute("SELECT model, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)"
                                " FROM llm_calls WHERE ts >= ? GROUP BY model", (day,)).fetchall()
        finally:
            conn.close()
        return sum(cost_usd(r[0], r[1], r[2]) for r in rows)

    def check_budget(self, est_usd: float) -> None:
        spent = self.spent_today()
        if spent + est_usd > self.budget_usd:
            raise DailyLimitExceeded(
                f"일일 LLM 예산 초과: 오늘 ${spent:.2f} + 예상 ${est_usd:.2f} > 예산 ${self.budget_usd:.2f}"
                " (PP_DAILY_BUDGET_USD)"
            )

    # ---- 호출 ----
    def call(self, stage: str, model: str, system: str, user: str, *, schema: dict,
             prompt_hash: str, max_tokens: int = 1024, retries: int = 3,
             job_id: str | None = None, required: tuple[str, ...] = ()) -> dict:
        """JSON dict를 반환. 재시도 후에도 실패하면 LLMError(원인 포함)를 던진다."""
        if not model:
            raise LLMError("모델 ID 미설정(PP_MODEL_*)")
        pin, pout = price_of(model)
        self.check_daily_limit(1)
        self.check_budget((estimate_tokens(system + user) * pin + max_tokens * pout) / 1_000_000)
        req = {
            "model": model, "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"format": {"type": "json_schema", "schema": api_schema(schema)}},
        }
        if supports_temperature(model):
            req["temperature"] = 0
        req.update(thinking_params(model))
        last_err: Exception | None = None
        for attempt in range(1, retries + 1):
            t0 = time.perf_counter()
            resp = None
            try:
                resp = self.client.messages.create(**req)
                text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
                stop = getattr(resp, "stop_reason", None)
                if stop in ("refusal", "max_tokens"):
                    raise LLMFinalError(stop)
                data = json.loads(text)
                if not isinstance(data, dict):
                    raise LLMOutputError("JSON 객체가 아님")
                missing = [k for k in required if k not in data]
                if missing:
                    raise LLMOutputError(f"필수 키 누락: {missing}")
                usage = getattr(resp, "usage", None)
                self._record(stage, model, prompt_hash, req, text, getattr(resp, "model", None),
                             "ok", None, int((time.perf_counter() - t0) * 1000), job_id,
                             getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None))
                return data
            except (json.JSONDecodeError, LLMOutputError) as e:
                # 응답을 받았으면 과금됐으므로 토큰도 기록해 예산에 반영한다
                last_err = e
                usage = getattr(resp, "usage", None)
                self._record(stage, model, prompt_hash, req, None, getattr(resp, "model", None), "failed",
                             f"{type(e).__name__}: {e}", int((time.perf_counter() - t0) * 1000), job_id,
                             getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None))
                if isinstance(e, LLMFinalError):
                    raise LLMError(f"{stage}: {e} — 재시도 안 함") from e
            except _RETRYABLE as e:
                last_err = e
                self._record(stage, model, prompt_hash, req, None, None, "failed", f"{type(e).__name__}: {e}",
                             int((time.perf_counter() - t0) * 1000), job_id)
            except anthropic.APIStatusError as e:
                # 400/401/403/404 등은 재시도해도 같다
                self._record(stage, model, prompt_hash, req, None, None, "failed", f"{type(e).__name__}: {e}",
                             int((time.perf_counter() - t0) * 1000), job_id)
                raise LLMError(f"{stage}: {type(e).__name__}: {getattr(e, 'message', e)}") from e
            if attempt < retries:
                self._sleep(min(8.0, 0.5 * (2 ** (attempt - 1))) + random.random() * 0.2)
        raise LLMError(f"{stage}: {retries}회 실패 — {type(last_err).__name__}: {last_err}") from last_err

    _RECORD_RETRIES = 5   # 수집 배치가 쓰기 잠금을 연속 점유하면 busy_timeout(5s)이 굶을 수 있다 → 지터 백오프 재시도

    def _record(self, stage, model, prompt_hash, req, response, response_model, status, error,
                elapsed_ms, job_id, in_tok=None, out_tok=None) -> None:
        """llm_calls 감사 행 기록. 일일 상한 계산·status 표시용이며 판정 캐시가 아니므로,
        잠금 재시도 후에도 실패하면 리포트를 죽이지 않고 jsonl 로그에만 남긴다."""
        row = (job_id, stage, model, response_model, prompt_hash,
               json.dumps(req, ensure_ascii=False), response, status, error, elapsed_ms,
               in_tok, out_tok, datetime.now(timezone.utc).isoformat(timespec="seconds"))
        record_error = None
        for attempt in range(1, self._RECORD_RETRIES + 1):
            conn = db.open_write(self.db_path)
            try:
                with conn:
                    conn.execute(
                        "INSERT INTO llm_calls(job_id, stage, model, response_model, prompt_hash, request, response,"
                        " status, error, elapsed_ms, input_tokens, output_tokens, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        row,
                    )
                record_error = None
                break
            except Exception as e:  # noqa: BLE001
                if not db.is_locked_error(e):
                    raise
                record_error = f"{type(e).__name__}: {e}"
            finally:
                conn.close()
            if attempt < self._RECORD_RETRIES:
                self._sleep(min(2.0, 0.1 * (2 ** (attempt - 1))) + random.random() * 0.1)
        log_event("llm_call", job_id=job_id, stage=stage, model=model, status=status,
                  elapsed_ms=elapsed_ms, error=error,
                  **({"record_error": record_error} if record_error else {}))


def list_models(client=None) -> list[dict]:
    """/v1/models 목록(모델 ID 스냅샷 확인용)."""
    client = client or anthropic.Anthropic()
    out = []
    for m in client.models.list():
        out.append({"id": m.id, "display_name": getattr(m, "display_name", ""),
                    "created_at": str(getattr(m, "created_at", ""))})
    return out


def load_prompt(name: str) -> str:
    return (config.PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
