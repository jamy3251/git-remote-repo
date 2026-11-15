import crypto from "node:crypto";
import type { ErrorInfo, ErrorRetry } from "./protocol.js";
import { redactSecrets } from "./security.js";

interface ErrorDef {
  status: number;
  retry: ErrorRetry;
  /** One line telling the caller (a person or an agent) what to do next. */
  fix: string;
}

/**
 * Every error code the runner can return. `docs/errors.md` has one `## <code>` section per entry
 * (a test checks this) and the web's `labels.ts` turns each code into a Korean sentence.
 */
export const ERRORS = {
  bad_request: { status: 400, retry: "after_fix", fix: "요청 필드를 확인하고 고쳐서 다시 보내세요." },
  invalid_json: { status: 400, retry: "after_fix", fix: "본문을 올바른 JSON으로 보내세요." },
  body_too_large: { status: 413, retry: "after_fix", fix: "본문을 줄이세요(대부분 64KB, 컴파일 1MB 상한)." },
  unknown_message: { status: 400, retry: "no", fix: "러너와 웹의 버전이 같은지 확인하세요. 프로토콜 사본이 다르면 생깁니다." },
  not_found: { status: 404, retry: "no", fix: "경로를 확인하세요. 러너 API는 /runner/ 아래에 있습니다." },
  host_not_allowed: { status: 403, retry: "after_fix", fix: "localhost나 127.0.0.1 주소로 여세요. 원격은 터널 주소를 쓰세요." },
  origin_not_allowed: { status: 403, retry: "after_fix", fix: "대시보드를 러너 주소나 RUNNER_ALLOWED_ORIGINS에 넣은 주소에서 여세요." },
  auth_invalid: { status: 401, retry: "after_fix", fix: "러너 시작 로그의 토큰을 설정에 다시 넣거나 PC 화면의 QR을 다시 찍으세요." },
  auth_required: { status: 401, retry: "after_fix", fix: "연결 직후 hello 메시지로 토큰을 보내세요." },
  auth_locked: { status: 429, retry: "after_ms", fix: "인증 실패가 반복돼 잠겼습니다. retryAfterMs 뒤 올바른 토큰으로 다시 시도하세요." },
  rate_limited: { status: 429, retry: "after_ms", fix: "요청 간격을 늘리고 잠시 뒤 다시 보내세요." },
  busy: { status: 409, retry: "after_ms", fix: "앞의 작업이 끝난 뒤 다시 보내세요." },
  session_not_found: { status: 404, retry: "no", fix: "세션 목록을 새로 받아 id를 확인하세요. 종료 후 제거된 세션일 수 있습니다." },
  session_limit: { status: 409, retry: "after_fix", fix: "끝난 세션을 정리하거나 RUNNER_MAX_SESSIONS를 늘리세요." },
  cwd_outside_root: { status: 403, retry: "after_fix", fix: "RUNNER_CWD_ROOT 아래 폴더를 고르세요." },
  path_forbidden: { status: 403, retry: "no", fix: "시스템 폴더나 루트 밖을 가리키는 링크는 열 수 없습니다. 다른 폴더를 고르세요." },
  folder_missing: { status: 404, retry: "after_fix", fix: "폴더가 있는지 확인하세요. 오타이거나 지워졌을 수 있습니다." },
  preset_unknown: { status: 400, retry: "after_fix", fix: "presets 목록에 있는 id를 쓰세요." },
  cli_missing: { status: 503, retry: "after_fix", fix: "필요한 CLI(claude, codex 또는 컴파일러)를 설치하고 PATH에 넣은 뒤 러너를 다시 시작하세요." },
  remote_forbidden: { status: 403, retry: "no", fix: "이 동작은 PC에서만 할 수 있습니다." },
  demo_unsupported: { status: 501, retry: "no", fix: "데모(npm run demo)에서는 안 됩니다. 실제 러너(npm run dev)에서 쓰세요." },
  internal: { status: 500, retry: "after_ms", fix: "잠시 뒤 다시 시도하세요. 계속되면 이벤트 로그에서 traceId를 찾아 원인을 보세요." },
} as const satisfies Record<string, ErrorDef>;

export type ErrorCode = keyof typeof ERRORS;
export const ERROR_CODES = Object.keys(ERRORS) as ErrorCode[];

/** A failure the runner expects and can explain. Anything else thrown is reported as `internal`. */
export class RunnerError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export function errorInfo(code: ErrorCode, message: string, extra: { retryAfterMs?: number; traceId?: string } = {}): ErrorInfo & { status: number } {
  const def = ERRORS[code];
  return {
    status: def.status,
    error: message,
    code,
    fix: def.fix,
    retry: def.retry,
    ...(extra.retryAfterMs !== undefined ? { retryAfterMs: extra.retryAfterMs } : {}),
    ...(extra.traceId ? { traceId: extra.traceId } : {}),
  };
}

/**
 * Turn anything thrown into the wire shape. Unexpected failures never echo their raw message to
 * the client: it goes to `log` (secrets masked) under a trace id the client gets instead.
 */
export function toErrorInfo(e: unknown, log: (traceId: string, detail: string) => void, secrets: string[] = []): ErrorInfo & { status: number } {
  if (e instanceof RunnerError) return errorInfo(e.code, e.message, { retryAfterMs: e.retryAfterMs });
  if (e instanceof SyntaxError) return errorInfo("invalid_json", "invalid JSON");
  const traceId = crypto.randomBytes(4).toString("hex");
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  let detail = redactSecrets(raw);
  for (const s of secrets) if (s) detail = detail.split(s).join("[redacted]");
  log(traceId, detail.slice(0, 2000));
  return errorInfo("internal", `내부 오류 (traceId ${traceId})`, { traceId });
}
