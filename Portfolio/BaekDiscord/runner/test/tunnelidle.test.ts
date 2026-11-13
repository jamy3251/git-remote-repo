import { describe, expect, it } from "vitest";
import { WARN_BEFORE_MS, closesAt, freshIdleState, tickIdle } from "../src/tunnelidle.js";

const MIN = 60_000;
const base = { startedAt: 0, idleMs: 60 * MIN, maxMs: 24 * 60 * MIN };

describe("tickIdle", () => {
  it("keeps the tunnel while a device is connected and restarts the idle clock", () => {
    const s = freshIdleState(0);
    expect(tickIdle(s, { ...base, now: 59 * MIN, remoteClients: 1, runningSessions: 0 })).toEqual({ kind: "none" });
    expect(s.lastRemoteAt).toBe(59 * MIN);
    expect(closesAt(s, base)).toBe(119 * MIN);
  });

  it("warns once five minutes before the deadline, then closes", () => {
    const s = freshIdleState(0);
    expect(tickIdle(s, { ...base, now: 60 * MIN - WARN_BEFORE_MS, remoteClients: 0, runningSessions: 0 })).toEqual({ kind: "warn", closesAt: 60 * MIN });
    expect(tickIdle(s, { ...base, now: 58 * MIN, remoteClients: 0, runningSessions: 0 })).toEqual({ kind: "none" });
    expect(tickIdle(s, { ...base, now: 60 * MIN, remoteClients: 0, runningSessions: 0 })).toEqual({ kind: "close", reason: "idle" });
  });

  it("extends once while a session is still running", () => {
    const s = freshIdleState(0);
    expect(tickIdle(s, { ...base, now: 60 * MIN, remoteClients: 0, runningSessions: 2 })).toEqual({ kind: "extend", closesAt: 120 * MIN });
    expect(tickIdle(s, { ...base, now: 120 * MIN, remoteClients: 0, runningSessions: 2 })).toEqual({ kind: "close", reason: "idle" });
  });

  it("a reconnect re-arms the extension", () => {
    const s = freshIdleState(0);
    tickIdle(s, { ...base, now: 60 * MIN, remoteClients: 0, runningSessions: 1 });
    tickIdle(s, { ...base, now: 70 * MIN, remoteClients: 1, runningSessions: 1 });
    expect(s.extendedAt).toBeNull();
    expect(tickIdle(s, { ...base, now: 130 * MIN, remoteClients: 0, runningSessions: 1 }).kind).toBe("extend");
  });

  it("closes at the absolute cap even with a device connected", () => {
    const s = freshIdleState(0);
    expect(tickIdle(s, { ...base, now: 24 * 60 * MIN, remoteClients: 3, runningSessions: 1 })).toEqual({ kind: "close", reason: "max" });
  });

  it("idleMs 0 disables idle closing; maxMs 0 disables the cap", () => {
    const s = freshIdleState(0);
    expect(tickIdle(s, { ...base, idleMs: 0, now: 10 * 60 * MIN, remoteClients: 0, runningSessions: 0 })).toEqual({ kind: "none" });
    expect(closesAt(s, { ...base, idleMs: 0 })).toBe(24 * 60 * MIN);
    expect(closesAt(s, { startedAt: 0, idleMs: 0, maxMs: 0 })).toBeNull();
  });
});
