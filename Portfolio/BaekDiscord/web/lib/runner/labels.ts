import type { ErrorInfo } from "./protocol";

/**
 * Korean sentence for each runner error code (docs/errors.md). A test checks that every code in
 * the doc has a label here.
 */
export const ERROR_LABELS: Record<string, string> = {
  bad_request: "요청 내용이 올바르지 않습니다.",
  invalid_json: "요청 형식이 올바르지 않습니다.",
  body_too_large: "보낸 내용이 너무 큽니다.",
  unknown_message: "러너가 이 요청을 모릅니다. 러너와 웹의 버전이 다를 수 있습니다.",
  not_found: "찾는 대상이 없습니다.",
  host_not_allowed: "이 주소로는 러너에 들어올 수 없습니다. localhost나 127.0.0.1로 여세요.",
  origin_not_allowed: "이 페이지 주소에서는 러너에 요청할 수 없습니다.",
  auth_invalid: "러너 토큰이 올바르지 않습니다.",
  auth_required: "러너 인증이 필요합니다.",
  auth_locked: "인증 실패가 반복되어 잠시 잠겼습니다.",
  rate_limited: "요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요.",
  busy: "앞의 작업이 아직 진행 중입니다.",
  session_not_found: "세션이 없습니다. 이미 정리됐을 수 있습니다.",
  session_limit: "동시에 돌릴 수 있는 세션 수에 닿았습니다.",
  cwd_outside_root: "작업 루트 밖의 폴더입니다.",
  path_forbidden: "열 수 없는 폴더입니다.",
  folder_missing: "폴더가 없습니다.",
  preset_unknown: "없는 실행 방식입니다.",
  cli_missing: "필요한 프로그램이 PC에 설치되어 있지 않습니다.",
  remote_forbidden: "이 동작은 PC에서만 할 수 있습니다.",
  demo_unsupported: "데모에서는 이 기능이 동작하지 않습니다.",
  internal: "러너 내부 오류가 났습니다.",
};

type ErrorLike = Partial<Omit<ErrorInfo, "error">> & { message?: string; error?: string };

const HANGUL = /[가-힣]/;

/**
 * What to show a person. Runner messages already written in Korean are specific (they name the
 * folder, the session) so they win; English ones are for logs and older clients, so the code's
 * label stands in. Unexpected failures add the trace id to look up in the event log.
 */
export function describeError(e: ErrorLike): string {
  const raw = e.message ?? e.error ?? "";
  const label = e.code ? ERROR_LABELS[e.code] : undefined;
  let text = raw && (HANGUL.test(raw) || !label) ? raw : (label ?? "알 수 없는 오류");
  if (e.retryAfterMs && e.retry === "after_ms") text += ` ${Math.ceil(e.retryAfterMs / 60_000)}분 뒤 다시 시도하세요.`;
  if (e.traceId) text = `${label ?? text} (추적 번호 ${e.traceId}, 이벤트 로그에서 찾을 수 있습니다)`;
  return text;
}

/** Error thrown by runner calls: the Korean text as `message`, the contract fields kept for code. */
export class RunnerCallError extends Error {
  constructor(readonly info: ErrorLike) {
    super(describeError(info));
    this.name = "RunnerCallError";
  }
}
