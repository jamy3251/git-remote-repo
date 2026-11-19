/**
 * Messenger notifications sent by the runner (docs/notify.md). The runner answers over HTTP:
 * GET /runner/notify, POST /runner/notify/test, POST /runner/notify/digest. Pure text helpers here
 * so they can be tested without a browser.
 */

export interface MessengerStatus {
  channels: string[];
  events: string[];
  digestMin: number;
}

export interface MessengerSendResult {
  channel: string;
  ok: boolean;
  error?: string;
}

const CHANNEL_LABEL: Record<string, string> = { discord: "디스코드", telegram: "텔레그램", kakao: "카카오톡" };
const EVENT_LABEL: Record<string, string> = { start: "시작", wait: "입력 대기", done: "완료", review: "교차검증", digest: "진행 요약" };
const EVENT_ORDER = ["start", "wait", "done", "review", "digest"];

export function channelLabel(name: string): string {
  return CHANNEL_LABEL[name] ?? name;
}

/** "시작 · 입력 대기 · 완료" in a fixed order; "진행 요약" carries its interval and drops out when the interval is 0. */
export function eventsText(s: MessengerStatus): string {
  const known = EVENT_ORDER.filter((e) => s.events.includes(e) && (e !== "digest" || s.digestMin > 0));
  const other = s.events.filter((e) => !EVENT_ORDER.includes(e));
  const parts = [...known, ...other].map((e) => (e === "digest" ? `${EVENT_LABEL.digest} ${s.digestMin}분마다` : (EVENT_LABEL[e] ?? e)));
  return parts.length ? parts.join(" · ") : "보내는 일 없음";
}

export interface ResultLine {
  text: string;
  ok: boolean;
}

/** One line per channel after a send; `sent: false` means the runner had nothing to report. */
export function resultLines(results: MessengerSendResult[], sent = true): ResultLine[] {
  if (!sent) return [{ text: "실행 중인 세션이 없어 보내지 않았습니다", ok: true }];
  return results.map((r) => (r.ok ? { text: `${channelLabel(r.channel)} 전송됨`, ok: true } : { text: `${channelLabel(r.channel)} 실패: ${r.error ?? "이유 없음"}`, ok: false }));
}
