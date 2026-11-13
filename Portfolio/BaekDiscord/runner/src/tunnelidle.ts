/**
 * When to close a forgotten tunnel. Pure so the timing rules can be tested with a fake clock.
 *
 *   tunnel opens ──▶ a remote device connected? ──yes──▶ idle clock restarts (lastRemoteAt = now)
 *                          │ no
 *                          ▼
 *        idle ≥ idleMs − 5 min ──▶ warn once (PC dashboard)
 *        idle ≥ idleMs ──▶ a session still running and not yet extended? ──yes──▶ extend once
 *                                   │ no
 *                                   ▼
 *                                 close
 *   open ≥ maxMs (absolute cap) ──▶ close, even with devices connected
 *
 * "Connected" means an authenticated socket on the tunnel listener that answered the last ping, so a
 * phone that went to sleep with a half-open socket does not keep the tunnel alive forever.
 */
export interface IdleState {
  /** Last time at least one remote device was connected (or when the tunnel opened). */
  lastRemoteAt: number;
  /** When the one extension for a running session was granted, or null. Cleared when a device reconnects. */
  extendedAt: number | null;
  /** Deadline the 5-minute warning was already sent for, so it fires once per deadline. */
  warnedFor: number | null;
}

export interface IdleInput {
  now: number;
  startedAt: number;
  remoteClients: number;
  runningSessions: number;
  /** Close after this long with no remote device; 0 disables idle closing. */
  idleMs: number;
  /** Absolute lifetime cap; 0 disables it. */
  maxMs: number;
}

export type IdleAction = { kind: "none" } | { kind: "warn"; closesAt: number } | { kind: "extend"; closesAt: number } | { kind: "close"; reason: "idle" | "max" };

export const WARN_BEFORE_MS = 5 * 60_000;

export function freshIdleState(now: number): IdleState {
  return { lastRemoteAt: now, extendedAt: null, warnedFor: null };
}

/** Next deadline the tunnel would close at, or null if it never closes on its own. */
export function closesAt(state: IdleState, input: Pick<IdleInput, "startedAt" | "idleMs" | "maxMs">): number | null {
  const idle = input.idleMs > 0 ? state.lastRemoteAt + input.idleMs : null;
  const max = input.maxMs > 0 ? input.startedAt + input.maxMs : null;
  if (idle === null) return max;
  if (max === null) return idle;
  return Math.min(idle, max);
}

/** Advance the idle state by one tick. Mutates `state` and returns what the caller should do. */
export function tickIdle(state: IdleState, input: IdleInput): IdleAction {
  const { now } = input;
  if (input.maxMs > 0 && now - input.startedAt >= input.maxMs) return { kind: "close", reason: "max" };
  if (input.remoteClients > 0) {
    state.lastRemoteAt = now;
    state.extendedAt = null;
    state.warnedFor = null;
    return { kind: "none" };
  }
  if (input.idleMs <= 0) return { kind: "none" };
  const deadline = state.lastRemoteAt + input.idleMs;
  if (now >= deadline) {
    if (input.runningSessions > 0 && state.extendedAt === null) {
      state.extendedAt = now;
      state.lastRemoteAt = now;
      state.warnedFor = null;
      return { kind: "extend", closesAt: closesAt(state, input) ?? now + input.idleMs };
    }
    return { kind: "close", reason: "idle" };
  }
  if (now >= deadline - WARN_BEFORE_MS && state.warnedFor !== deadline) {
    state.warnedFor = deadline;
    return { kind: "warn", closesAt: closesAt(state, input) ?? deadline };
  }
  return { kind: "none" };
}
