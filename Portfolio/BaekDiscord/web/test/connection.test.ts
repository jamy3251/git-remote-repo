import { describe, expect, it } from "vitest";
import { Backoff, attentionCount, badgeText, connectionText, diffNotices, pongOverdue, shouldNotify, titleWithBadge } from "@/lib/runner/connection";
import type { SessionInfo } from "@/lib/runner/protocol";

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: "s1",
    name: "작업",
    preset: "claude",
    command: "claude",
    cwd: "D:/p",
    mode: "pty",
    status: "running",
    pid: 1,
    exitCode: null,
    createdAt: 0,
    endedAt: null,
    bytes: 0,
    tags: [],
    goal: null,
    policy: "assist",
    state: "working",
    stateReason: "",
    lastOutputAt: null,
    lastLine: "",
    suggestion: null,
    cols: 80,
    rows: 24,
    ...over,
  };
}

describe("Backoff", () => {
  it("doubles up to the cap and resets", () => {
    const b = new Backoff({ baseMs: 1000, maxMs: 8000, jitter: 0, random: () => 0.5 });
    expect([b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([1000, 2000, 4000, 8000, 8000]);
    b.reset();
    expect(b.next()).toBe(1000);
  });
  it("adds bounded jitter and never goes below half the base", () => {
    const hi = new Backoff({ baseMs: 1000, jitter: 0.25, random: () => 1 });
    const lo = new Backoff({ baseMs: 1000, jitter: 0.25, random: () => 0 });
    expect(hi.next()).toBe(1250);
    expect(lo.next()).toBe(750);
    const tiny = new Backoff({ baseMs: 1000, jitter: 1, random: () => 0 });
    expect(tiny.next()).toBe(500);
  });
});

describe("pongOverdue", () => {
  it("flags a socket whose last ack is older than the watchdog", () => {
    expect(pongOverdue(0, 10_000, 55_000)).toBe(false);
    expect(pongOverdue(0, 55_001, 55_000)).toBe(true);
  });
});

describe("badge", () => {
  it("caps at 99+ and clears at zero", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(150)).toBe("99+");
    expect(titleWithBadge("관제 · DevHub", 0)).toBe("관제 · DevHub");
    expect(titleWithBadge("관제 · DevHub", 2)).toBe("(2) 관제 · DevHub");
  });
  it("counts only running sessions that need a human", () => {
    const list = [session({ id: "a", state: "waiting_input" }), session({ id: "b", state: "error" }), session({ id: "c", state: "waiting_input", status: "exited" }), session({ id: "d" })];
    expect(attentionCount(list)).toBe(2);
  });
});

describe("diffNotices", () => {
  it("reports transitions into waiting/error, new suggestions, and finished sessions", () => {
    const prev = [session({ id: "a" }), session({ id: "b" }), session({ id: "c" }), session({ id: "d", state: "waiting_input" })];
    const next = [
      session({ id: "a", state: "waiting_input", lastLine: "Proceed? (y/n)" }),
      session({ id: "b", state: "error" }),
      session({ id: "c", status: "exited", exitCode: 0 }),
      session({ id: "d", state: "waiting_input", suggestion: { id: "x", createdAt: 1, kind: "escalate", label: "force push 감지", rationale: "", confidence: 0.9, source: "heuristic" } }),
      session({ id: "e", state: "waiting_input" }),
    ];
    const n = diffNotices(prev, next);
    expect(n.map((x) => [x.sessionId, x.kind, x.priority])).toEqual([
      ["a", "waiting", false],
      ["b", "error", true],
      ["c", "done", false],
      ["d", "escalate", true],
    ]);
    expect(n[0].body).toBe("Proceed? (y/n)");
  });
  it("is silent when nothing changed", () => {
    const s = [session({ id: "a", state: "waiting_input" })];
    expect(diffNotices(s, s)).toEqual([]);
  });
  it("marks a non-zero exit as a priority failure", () => {
    const n = diffNotices([session({ id: "a" })], [session({ id: "a", status: "exited", exitCode: 1 })]);
    expect(n[0]).toMatchObject({ kind: "done", priority: true, title: "작업 · 실패" });
  });
});

describe("shouldNotify", () => {
  it("never toasts while the dashboard is in front", () => {
    expect(shouldNotify({ hidden: false, focused: true, mode: "all", priority: true })).toBe(false);
    expect(shouldNotify({ hidden: true, focused: false, mode: "all", priority: false })).toBe(true);
    expect(shouldNotify({ hidden: false, focused: false, mode: "all", priority: false })).toBe(true);
  });
  it("honors quiet modes", () => {
    expect(shouldNotify({ hidden: true, focused: false, mode: "off", priority: true })).toBe(false);
    expect(shouldNotify({ hidden: true, focused: false, mode: "priority", priority: false })).toBe(false);
    expect(shouldNotify({ hidden: true, focused: false, mode: "priority", priority: true })).toBe(true);
  });
});

describe("connectionText", () => {
  it("shows the retry countdown and the round-trip time", () => {
    expect(connectionText("open", null, 0, null)).toBe("연결됨");
    expect(connectionText("open", null, 0, 12)).toBe("연결됨 · 12ms");
    expect(connectionText("reconnecting", 4_000, 1_000, null)).toBe("끊김 · 3초 후 다시 연결");
    expect(connectionText("reconnecting", 1_000, 1_000, null)).toBe("다시 연결하는 중…");
    expect(connectionText("unauthorized", null, 0, null)).toBe("토큰 오류");
  });
});
