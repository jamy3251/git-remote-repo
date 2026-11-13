/**
 * Connection and attention rules for the dashboard. Pure functions so they can be unit-tested
 * without a browser. The patterns come from how shipped desktop messengers behave:
 * - exponential backoff with jitter and a cap, reset after a successful connect, plus a ping/ack
 *   watchdog that closes a silent socket so the backoff loop takes over (Figma's multiplayer socket:
 *   backoff.nextBackoffMs, pingInterval, getLastAckTime);
 * - an unread badge capped at "99+" and cleared at zero (Slack picks overlay icon 100 for >99 and
 *   an empty image for 0; Discord caps its overlay-icon index the same way);
 * - "flash/notify only when the window is not focused" (Discord: flashFrame(!isFocused && flag);
 *   Slack: windows-focus-assist check before a toast, priority notifications still pass).
 */
import type { SessionInfo } from "./protocol";

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  /** ±fraction of the delay added as jitter so many phones do not reconnect in lockstep. */
  jitter?: number;
  random?: () => number;
}

export class Backoff {
  private attempt = 0;
  private readonly base: number;
  private readonly max: number;
  private readonly factor: number;
  private readonly jitter: number;
  private readonly random: () => number;

  constructor(o: BackoffOptions = {}) {
    this.base = o.baseMs ?? 1000;
    this.max = o.maxMs ?? 30_000;
    this.factor = o.factor ?? 2;
    this.jitter = o.jitter ?? 0.25;
    this.random = o.random ?? Math.random;
  }

  /** Delay before the next attempt, in ms; grows each call until reset(). */
  next(): number {
    const raw = Math.min(this.max, this.base * this.factor ** this.attempt);
    this.attempt += 1;
    const j = raw * this.jitter * (this.random() * 2 - 1);
    return Math.max(Math.round(this.base / 2), Math.round(raw + j));
  }

  get attempts(): number {
    return this.attempt;
  }

  reset(): void {
    this.attempt = 0;
  }
}

/** Ping cadence and how long a missing pong is tolerated before the socket is declared dead. */
export const PING_INTERVAL_MS = 25_000;
export const PONG_TIMEOUT_MS = 2 * PING_INTERVAL_MS + 5_000;

/** True when the last acknowledgement is older than the watchdog allows. */
export function pongOverdue(lastAckAt: number, now: number, timeoutMs = PONG_TIMEOUT_MS): boolean {
  return now - lastAckAt > timeoutMs;
}

/** Sessions that need a human right now (same rule as the session board's "주의" filter). */
export function isAttention(s: SessionInfo): boolean {
  return s.status === "running" && (s.state === "waiting_input" || s.state === "error" || s.suggestion !== null);
}

export function attentionCount(sessions: SessionInfo[]): number {
  return sessions.filter(isAttention).length;
}

/** Badge label: empty at zero, "99+" past 99. */
export function badgeText(n: number): string {
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}

export function titleWithBadge(base: string, n: number): string {
  const b = badgeText(n);
  return b ? `(${b}) ${base}` : base;
}

export type NotifyMode = "all" | "priority" | "off";

export interface Notice {
  sessionId: string;
  name: string;
  kind: "waiting" | "error" | "escalate" | "suggest" | "done";
  /** Priority notices (errors, human-confirmation requests) pass the "priority only" quiet mode. */
  priority: boolean;
  title: string;
  body: string;
}

/** Sessions that changed into a state worth a notification between two snapshots. */
export function diffNotices(prev: SessionInfo[], next: SessionInfo[]): Notice[] {
  const before = new Map(prev.map((s) => [s.id, s]));
  const out: Notice[] = [];
  for (const s of next) {
    const p = before.get(s.id);
    if (!p) continue; // first sight: no transition to report (a new session is announced in the feed)
    if (s.status === "running") {
      if (s.state === "waiting_input" && p.state !== "waiting_input") {
        out.push({ sessionId: s.id, name: s.name, kind: "waiting", priority: false, title: `${s.name} · 입력 대기`, body: s.lastLine || s.stateReason });
      } else if (s.state === "error" && p.state !== "error") {
        out.push({ sessionId: s.id, name: s.name, kind: "error", priority: true, title: `${s.name} · 오류`, body: s.lastLine || s.stateReason });
      }
      if (s.suggestion && s.suggestion.id !== p.suggestion?.id) {
        const esc = s.suggestion.kind === "escalate";
        out.push({ sessionId: s.id, name: s.name, kind: esc ? "escalate" : "suggest", priority: esc, title: `${s.name} · ${esc ? "확인 필요" : "슈퍼바이저 제안"}`, body: s.suggestion.label });
      }
    } else if (p.status === "running") {
      const failed = s.status === "error" || (s.exitCode !== null && s.exitCode !== 0);
      out.push({ sessionId: s.id, name: s.name, kind: "done", priority: failed, title: `${s.name} · ${failed ? "실패" : "완료"}`, body: s.lastLine || (s.exitCode !== null ? `종료 코드 ${s.exitCode}` : "") });
    }
  }
  return out;
}

export interface NotifyContext {
  /** Page hidden (tab in background, phone screen off). */
  hidden: boolean;
  /** Window has keyboard focus: the person is looking at it, so no toast. */
  focused: boolean;
  mode: NotifyMode;
  priority: boolean;
}

/** Whether to show a system notification: never while the dashboard is in front; honor quiet modes. */
export function shouldNotify(c: NotifyContext): boolean {
  if (c.mode === "off") return false;
  if (!c.hidden && c.focused) return false;
  if (c.mode === "priority") return c.priority;
  return true;
}

/** Human-readable connection state for banners. */
export function connectionText(status: string, nextRetryAt: number | null, now: number, rttMs: number | null): string {
  switch (status) {
    case "open":
      return rttMs === null ? "연결됨" : `연결됨 · ${rttMs}ms`;
    case "connecting":
      return "연결 중…";
    case "reconnecting": {
      const secs = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : 0;
      return secs > 0 ? `끊김 · ${secs}초 후 다시 연결` : "다시 연결하는 중…";
    }
    case "unauthorized":
      return "토큰 오류";
    case "closed":
      return "끊김";
    default:
      return "미연결";
  }
}
