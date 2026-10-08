"""Anthropic SDK 호출 래퍼.

- 모든 호출은 temperature=0(지원 모델), JSON 스키마 출력(output_config.format), 재시도 N회(지수 백오프).
- 호출마다 llm_calls에 요청·응답·응답 model·토큰·소요시간을 기록한다(리포트 재렌더·감사용).
- 일일 호출 상한(DailyLimitExceeded): 오늘 llm_calls 행 수 ≥ 상한이면 호출 전에 거부.
- 달러 예산은 범위별로 센다(report ⊃ promotion, radar ⊃ chat, diag). 범위는 LLM(scope=)이 정하고, 없으면 단계 이름으로
  정한다(chat → chat, radar_* → radar, diag_* → diag, 나머지 → report). 시도마다 호출 직전에 예약한다:
  BEGIN IMMEDIATE 안에서 (기록된 지출 + 유효 예약 + 이번 최대 비용) ≤ 상한(자기 범위와 상위 범위 모두)일 때만 예약하고,
  끝나면 llm_calls 행 기록과 예약 삭제를 한 트랜잭션으로 한다. 그래서 여러 프로세스가 동시에 불러도 상한을 넘지 않는다.
  기록이 잠금으로 실패한 호출은 jsonl 로그(record_error + 토큰)에서 복구해 지출에 더한다.
  가격표(config.PRICES)에 없는 모델은 거부한다. 재시도는 이 래퍼만 한다(SDK max_retries=0) → 모든 시도가 기록·집계된다.
- 외부 원문(논문 초록·기사·특허 등 `<doc>` 블록)을 보내는 단계(radar_*)는 llm_calls.request에 원문 대신
  "sha256:… len:N url:…"만 남긴다(설계 Constraints: 외부 원문은 처리 후 폐기). 보내는 요청은 그대로다.
- 잘림(max_tokens)·거절(refusal)은 temperature 0에서 다시 보내도 같으므로 재시도하지 않는다.
- 사고(thinking)가 기본으로 켜지는 모델은 끈다: 짧은 JSON 출력에 사고 토큰이 붙으면 비용이 늘고 max_tokens에 잘린다.
- 테스트는 `client=`로 가짜 클라이언트를 주입한다(같은 인터페이스: .messages.create(...)).
"""
from __future__ import annotations

import json
import random
import re
import time
from datetime import datetime, timedelta, timezone
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


# ---- 외부 원문 축약 기록 ----
_DOC_RE = re.compile(r"<doc\b([^>]*)>(.*?)</doc>", re.S)
_URL_ATTR = re.compile(r"""\burl\s*=\s*["']([^"']*)["']""")


def redacts_docs(stage: str) -> bool:
    """레이더 연결층(필요·능력·한계 추출, 간선 판정, 사건 범주 확인)은 외부 원문을 보낸다."""
    return stage.startswith("radar_")


def redact_docs(text: str) -> str:
    """`<doc …>본문</doc>`의 본문을 "sha256:<hex> len:<글자 수> url:<url>"로 바꾼다. 속성(id·url)은 남긴다."""
    import hashlib

    def sub(m: re.Match) -> str:
        attrs, body = m.group(1), m.group(2)
        url = _URL_ATTR.search(attrs)
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        return f"<doc{attrs}>sha256:{digest} len:{len(body)}" + (f" url:{url.group(1)}" if url else "") + "</doc>"
    return _DOC_RE.sub(sub, text)


def _logged_request(req: dict, redact: bool) -> str:
    if not redact:
        return json.dumps(req, ensure_ascii=False)
    r = dict(req)
    r["system"] = redact_docs(req.get("system", ""))
    r["messages"] = [{**m, "content": redact_docs(m["content"]) if isinstance(m.get("content"), str) else m.get("content")}
                     for m in req.get("messages", [])]
    return json.dumps(r, ensure_ascii=False)


# ---- 예산 범위 ----
SCOPES = ("report", "promotion", "radar", "chat", "diag")
_PARENT = {"promotion": "report", "chat": "radar"}


def scope_of_stage(stage: str) -> str:
    if stage == "chat" or stage.startswith("chat_"):
        return "chat"
    if stage.startswith("radar_"):
        return "radar"
    if stage.startswith("diag_"):
        return "diag"
    return "report"


def scope_chain(scope: str) -> list[str]:
    """자기 범위 → 상위 범위. 예: chat → [chat, radar]."""
    out = [scope]
    while out[-1] in _PARENT:
        out.append(_PARENT[out[-1]])
    return out


def scope_members(scope: str) -> list[str]:
    """이 범위의 지출로 셀 범위들(자기 + 하위). 예: report → [report, promotion]."""
    return [s for s in SCOPES if scope in scope_chain(s)]


def window_start(scope: str, now: datetime | None = None) -> str:
    """예산 창 시작(UTC ISO). diag는 이번 주 월요일, 나머지는 오늘."""
    now = now or datetime.now(timezone.utc)
    day = now.date()
    if scope_chain(scope)[-1] == "diag":
        day = day - timedelta(days=day.weekday())
    return day.isoformat()


def _unrecorded_cost(members: list[str], since: str) -> float:
    """llm_calls 기록에 실패한 호출(jsonl의 record_error)의 비용. 로그 파일은 로컬 날짜별이라 창보다 하루 넓게 읽는다."""
    since_day = datetime.fromisoformat(since).date() - timedelta(days=1)
    total = 0.0
    d = Path(config.LOG_DIR)
    if not d.exists():
        return 0.0
    for f in d.glob("*.jsonl"):
        try:
            if datetime.strptime(f.stem, "%Y-%m-%d").date() < since_day:
                continue
            with open(f, encoding="utf-8") as fh:
                for line in fh:
                    if '"record_error"' not in line or '"llm_call"' not in line:
                        continue
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    if rec.get("event") != "llm_call" or rec.get("ts", "") < since:
                        continue
                    if rec.get("scope", "report") not in members:
                        continue
                    total += cost_usd(rec.get("model", ""), rec.get("in_tok") or 0, rec.get("out_tok") or 0)
        except (OSError, ValueError):
            continue
    return total


class LLM:
    def __init__(self, db_path: str | Path | None = None, *, client=None,
                 daily_limit: int | None = None, budget_usd: float | None = None, sleep=time.sleep,
                 scope: str | None = None):
        """budget_usd는 report 범위 상한(기본 PP_DAILY_BUDGET_USD). scope를 주면 모든 호출이 그 범위로 청구된다
        (예: 승격 큐는 LLM(scope="promotion") — 단계 이름이 classify여도 승격 몫으로 센다)."""
        if scope is not None and scope not in SCOPES:
            raise ValueError(f"알 수 없는 예산 범위: {scope}")
        self.db_path = Path(db_path or config.DB_PATH)
        self._client = client
        self.daily_limit = config.DAILY_LLM_LIMIT if daily_limit is None else daily_limit
        self.budget_usd = config.DAILY_BUDGET_USD if budget_usd is None else budget_usd
        self._sleep = sleep
        self.scope = scope

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

    # ---- 예산(범위별) ----
    def limit_of(self, scope: str) -> float:
        return {"report": self.budget_usd, "promotion": config.BUDGET_PROMOTION_USD,
                "radar": config.RADAR_BUDGET_USD, "chat": config.BUDGET_CHAT_USD,
                "diag": config.DIAG_BUDGET_USD}[scope]

    def _scope_for(self, stage: str) -> str:
        return self.scope or scope_of_stage(stage)

    @staticmethod
    def _spent(conn, scope: str) -> float:
        members = scope_members(scope)
        since = window_start(scope)
        rows = conn.execute(
            "SELECT model, COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM llm_calls"
            " WHERE ts >= ? AND scope IN (%s) GROUP BY model" % ",".join("?" * len(members)),
            (since, *members)).fetchall()
        return sum(cost_usd(r[0], r[1], r[2]) for r in rows) + _unrecorded_cost(members, since)

    @staticmethod
    def _reserved(conn, scope: str, now_iso: str) -> tuple[float, int]:
        members = scope_members(scope)
        r = conn.execute("SELECT COALESCE(SUM(est_usd),0), COUNT(*) FROM budget_reservations"
                         " WHERE expires_at > ? AND scope IN (%s)" % ",".join("?" * len(members)),
                         (now_iso, *members)).fetchone()
        return float(r[0]), int(r[1])

    def spent_today(self, scope: str = "report") -> float:
        """기록된 지출(예약 제외). report는 승격 몫 포함."""
        conn = db.open_read(self.db_path)
        try:
            return self._spent(conn, scope)
        finally:
            conn.close()

    def _admit(self, conn, scope: str, est_usd: float, *, with_reserved: bool) -> None:
        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for s in scope_chain(scope):
            spent = self._spent(conn, s)
            held, _ = self._reserved(conn, s, now_iso) if with_reserved else (0.0, 0)
            if spent + held + est_usd > self.limit_of(s):
                raise DailyLimitExceeded(
                    f"LLM 예산 초과({s}): 지출 ${spent:.2f} + 진행 중 ${held:.2f} + 예상 ${est_usd:.2f}"
                    f" > 상한 ${self.limit_of(s):.2f}")
        if scope == "chat":
            n = conn.execute("SELECT COUNT(*) FROM llm_calls WHERE scope='chat' AND ts >= ?",
                             (window_start("chat"),)).fetchone()[0]
            held_n = self._reserved(conn, "chat", now_iso)[1] if with_reserved else 0
            if n + held_n + 1 > config.CHAT_CALL_LIMIT:
                raise DailyLimitExceeded(f"대화 호출 한도 도달: 오늘 {n}회 + 진행 중 {held_n}회 ≥ {config.CHAT_CALL_LIMIT}회")

    def check_budget(self, est_usd: float, scope: str | None = None) -> None:
        """일괄 작업 전 사전 견적(예약 없음). 실제 호출은 call()이 시도마다 예약한다."""
        conn = db.open_read(self.db_path)
        try:
            self._admit(conn, scope or self.scope or "report", est_usd, with_reserved=True)
        finally:
            conn.close()

    def reserve(self, scope: str, est_usd: float) -> int:
        """원자적 예약. 상한을 넘으면 DailyLimitExceeded. 반환: 예약 id(완료 시 _record가 지운다)."""
        last: Exception | None = None
        for attempt in range(1, self._RECORD_RETRIES + 1):
            conn = db.open_write(self.db_path)
            try:
                conn.execute("BEGIN IMMEDIATE")
                try:
                    now = datetime.now(timezone.utc)
                    conn.execute("DELETE FROM budget_reservations WHERE expires_at <= ?",
                                 (now.isoformat(timespec="seconds"),))
                    self._admit(conn, scope, est_usd, with_reserved=True)
                    cur = conn.execute(
                        "INSERT INTO budget_reservations(scope, est_usd, created_at, expires_at) VALUES (?,?,?,?)",
                        (scope, est_usd, now.isoformat(timespec="seconds"),
                         (now + timedelta(seconds=config.RESERVATION_TTL_S)).isoformat(timespec="seconds")))
                    conn.commit()
                    return int(cur.lastrowid)
                except Exception:
                    conn.rollback()
                    raise
            except Exception as e:  # noqa: BLE001
                if not db.is_locked_error(e):
                    raise
                last = e
            finally:
                conn.close()
            if attempt < self._RECORD_RETRIES:
                self._sleep(min(2.0, 0.1 * (2 ** (attempt - 1))) + random.random() * 0.1)
        raise LLMError(f"예산 예약 실패(DB 잠금): {last}")

    # ---- 호출 ----
    def call(self, stage: str, model: str, system: str, user: str, *, schema: dict,
             prompt_hash: str, max_tokens: int = 1024, retries: int = 3,
             job_id: str | None = None, required: tuple[str, ...] = ()) -> dict:
        """JSON dict를 반환. 재시도 후에도 실패하면 LLMError(원인 포함)를 던진다."""
        if not model:
            raise LLMError("모델 ID 미설정(PP_MODEL_*)")
        pin, pout = price_of(model)
        scope = self._scope_for(stage)
        est = (estimate_tokens(system + user) * pin + max_tokens * pout) / 1_000_000
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
            self.check_daily_limit(1)
            rid = self.reserve(scope, est)   # 재시도도 시도마다 예약 → 재시도가 상한을 넘지 못한다
            rec = {"scope": scope, "reservation_id": rid, "redact": redacts_docs(stage)}
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
                             getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None), **rec)
                return data
            except (json.JSONDecodeError, LLMOutputError) as e:
                # 응답을 받았으면 과금됐으므로 토큰도 기록해 예산에 반영한다
                last_err = e
                usage = getattr(resp, "usage", None)
                self._record(stage, model, prompt_hash, req, None, getattr(resp, "model", None), "failed",
                             f"{type(e).__name__}: {e}", int((time.perf_counter() - t0) * 1000), job_id,
                             getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None), **rec)
                if isinstance(e, LLMFinalError):
                    raise LLMError(f"{stage}: {e} — 재시도 안 함") from e
            except _RETRYABLE as e:
                last_err = e
                self._record(stage, model, prompt_hash, req, None, None, "failed", f"{type(e).__name__}: {e}",
                             int((time.perf_counter() - t0) * 1000), job_id, **rec)
            except anthropic.APIStatusError as e:
                # 400/401/403/404 등은 재시도해도 같다
                self._record(stage, model, prompt_hash, req, None, None, "failed", f"{type(e).__name__}: {e}",
                             int((time.perf_counter() - t0) * 1000), job_id, **rec)
                raise LLMError(f"{stage}: {type(e).__name__}: {getattr(e, 'message', e)}") from e
            if attempt < retries:
                self._sleep(min(8.0, 0.5 * (2 ** (attempt - 1))) + random.random() * 0.2)
        raise LLMError(f"{stage}: {retries}회 실패 — {type(last_err).__name__}: {last_err}") from last_err

    _RECORD_RETRIES = 5   # 수집 배치가 쓰기 잠금을 연속 점유하면 busy_timeout(5s)이 굶을 수 있다 → 지터 백오프 재시도

    def _record(self, stage, model, prompt_hash, req, response, response_model, status, error,
                elapsed_ms, job_id, in_tok=None, out_tok=None, *, scope: str = "report",
                reservation_id: int | None = None, redact: bool = False) -> None:
        """llm_calls 감사 행 기록 + 예약 해제(한 트랜잭션 = 예약을 실제 비용으로 교체).
        잠금 재시도 후에도 실패하면 리포트를 죽이지 않고 jsonl 로그(토큰 포함)에 남기고, 예산 합산이 그 로그를 읽는다.
        이때 예약은 만료(RESERVATION_TTL_S)까지 남아 보수적으로 이중 계산된다."""
        row = (job_id, stage, model, response_model, prompt_hash,
               _logged_request(req, redact), response, status, error, elapsed_ms,
               in_tok, out_tok, datetime.now(timezone.utc).isoformat(timespec="seconds"), scope)
        record_error = None
        for attempt in range(1, self._RECORD_RETRIES + 1):
            conn = db.open_write(self.db_path)
            try:
                with conn:
                    conn.execute(
                        "INSERT INTO llm_calls(job_id, stage, model, response_model, prompt_hash, request, response,"
                        " status, error, elapsed_ms, input_tokens, output_tokens, ts, scope)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        row,
                    )
                    if reservation_id is not None:
                        conn.execute("DELETE FROM budget_reservations WHERE id = ?", (reservation_id,))
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
                  elapsed_ms=elapsed_ms, error=error, scope=scope,
                  **({"record_error": record_error, "in_tok": in_tok, "out_tok": out_tok} if record_error else {}))


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
