import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import { SessionManager } from "../src/sessions.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import { ControlChat, parseStep } from "../src/supervisor/chat.js";
import type { Brain, BrainDecision, BrainJudgeInput, BrainMessage } from "../src/supervisor/brain.js";
import type { SupervisorEvent } from "../src/protocol.js";

const isWin = process.platform === "win32";

/** A scripted brain so tests never call a real model. */
class FakeBrain implements Brain {
  kind = "api" as const;
  model = "fake";
  judgeCalls = 0;
  completions: string[] = [];
  constructor(private decision: BrainDecision | null) {}
  async judge(_input: BrainJudgeInput): Promise<BrainDecision | null> {
    this.judgeCalls += 1;
    return this.decision;
  }
  async complete(_system: string, _messages: BrainMessage[]): Promise<string | null> {
    return this.completions.shift() ?? JSON.stringify({ final: "끝" });
  }
}

class NoBrain implements Brain {
  kind = "heuristic" as const;
  model = null;
  async judge(): Promise<null> {
    return null;
  }
  async complete(): Promise<null> {
    return null;
  }
}

function manager() {
  return new SessionManager({ cwdRoot: os.tmpdir(), maxSessions: 4, historyBytes: 64 * 1024, defaultPolicy: "assist" });
}

/** A shell command that prints a question and waits for a line of input. */
function promptCommand(text: string): string {
  // cmd expands %var% when the line is parsed, so delayed expansion (!var!) is required to echo the answer.
  return isWin ? `cmd.exe /q /v:on /c "echo ${text}& set /p answer= & echo got !answer!"` : `sh -c 'echo "${text}"; read answer; echo got $answer'`;
}

async function waitFor(pred: () => boolean, ms = 8000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("Supervisor", () => {
  let sessions: SessionManager;
  afterEach(() => sessions.killAll());
  beforeEach(() => {
    sessions = manager();
  });

  it("detects a (y/n) prompt, escalates under assist with no brain, and sends input on approval", async () => {
    const sup = new Supervisor(sessions, new NoBrain(), { enabled: true, defaultPolicy: "assist", intervalMs: 100_000 });
    const events: SupervisorEvent[] = [];
    sup.on("event", (e: SupervisorEvent) => events.push(e));
    const s = sessions.create({ preset: "custom", command: promptCommand("Overwrite? (y/n)"), cwd: os.tmpdir() });
    await waitFor(() => sessions.tail(s.id, 5).some((l) => l.includes("(y/n)")));
    // Pretend output settled a while ago so the prompt counts as waiting.
    const now = Date.now() + 10_000;
    await sup.tick(now);
    expect(sessions.get(s.id)?.state).toBe("waiting_input");
    const sug = sessions.get(s.id)?.suggestion;
    expect(sug?.kind).toBe("escalate");
    expect(events.some((e) => e.level === "warn" && e.sessionId === s.id)).toBe(true);

    // Hash guard: a second tick with identical output must not re-judge.
    await sup.tick(now + 1000);
    expect(sessions.get(s.id)?.suggestion?.id).toBe(sug?.id);

    sup.decide(s.id, sug!.id, "dismiss", "human");
    expect(sessions.get(s.id)?.suggestion).toBeNull();
  });

  it("auto policy sends a safe brain response and logs it", async () => {
    const brain = new FakeBrain({ state: "waiting_input", summary: "덮어쓰기 질문", action: "respond", input: "y\r", confidence: 0.9, rationale: "목표상 덮어써도 됨" });
    const sup = new Supervisor(sessions, brain, { enabled: true, defaultPolicy: "auto", intervalMs: 100_000 });
    const events: SupervisorEvent[] = [];
    sup.on("event", (e: SupervisorEvent) => events.push(e));
    const s = sessions.create({ preset: "custom", command: promptCommand("Overwrite? (y/n)"), cwd: os.tmpdir(), policy: "auto", goal: "설정 파일 덮어쓰기" });
    await waitFor(() => sessions.tail(s.id, 5).some((l) => l.includes("(y/n)")));
    await sup.tick(Date.now() + 10_000);
    expect(brain.judgeCalls).toBe(1);
    await waitFor(() => sessions.tail(s.id, 5).some((l) => l.includes("got y")));
    expect(events.some((e) => e.level === "action" && /자율 응답/.test(e.message))).toBe(true);
  });

  it("never auto-responds when the output looks dangerous", async () => {
    const brain = new FakeBrain({ state: "waiting_input", summary: "", action: "respond", input: "y\r", confidence: 0.99, rationale: "" });
    const sup = new Supervisor(sessions, brain, { enabled: true, defaultPolicy: "auto", intervalMs: 100_000 });
    const s = sessions.create({ preset: "custom", command: promptCommand("Run rm -rf build? (y/n)"), cwd: os.tmpdir(), policy: "auto" });
    await waitFor(() => sessions.tail(s.id, 5).some((l) => l.includes("(y/n)")));
    await sup.tick(Date.now() + 10_000);
    expect(brain.judgeCalls).toBe(0); // danger short-circuits the brain
    const sug = sessions.get(s.id)?.suggestion;
    expect(sug?.kind).toBe("escalate");
    expect(sessions.tail(s.id, 5).some((l) => l.includes("got y"))).toBe(false);
  });

  it("manual policy only observes", async () => {
    const brain = new FakeBrain({ state: "waiting_input", summary: "", action: "respond", input: "\r", confidence: 0.9, rationale: "" });
    const sup = new Supervisor(sessions, brain, { enabled: true, defaultPolicy: "manual", intervalMs: 100_000 });
    const s = sessions.create({ preset: "custom", command: promptCommand("Press Enter to continue"), cwd: os.tmpdir(), policy: "manual" });
    await waitFor(() => sessions.tail(s.id, 5).some((l) => l.includes("Press Enter")));
    await sup.tick(Date.now() + 10_000);
    expect(sessions.get(s.id)?.state).toBe("waiting_input");
    expect(sessions.get(s.id)?.suggestion).toBeNull();
    expect(brain.judgeCalls).toBe(0);
  });

  it("tracks activity buckets and config changes", async () => {
    const sup = new Supervisor(sessions, new NoBrain(), { enabled: false, defaultPolicy: "assist", intervalMs: 100_000 });
    const s = sessions.create({ preset: "custom", command: isWin ? "echo activity-bytes" : "echo activity-bytes", cwd: os.tmpdir() });
    await waitFor(() => sessions.get(s.id)?.status === "exited");
    await sup.tick();
    expect(sup.activity(s.id).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const cfg = sup.setConfig({ enabled: true, defaultPolicy: "auto" }, "human");
    expect(cfg.enabled).toBe(true);
    expect(cfg.defaultPolicy).toBe("auto");
    expect(sup.recentEvents(10).some((e) => /기본 정책/.test(e.message))).toBe(true);
  });
});

describe("ControlChat", () => {
  it("parses tool and final steps", () => {
    expect(parseStep('{"tool":"list_sessions","args":{}}')).toEqual({ kind: "tool", tool: "list_sessions", args: {} });
    expect(parseStep('text before {"final":"done"} after')).toEqual({ kind: "final", text: "done" });
    expect(parseStep("plain prose")).toEqual({ kind: "text", text: "plain prose" });
  });

  it("runs a tool loop: list sessions, create one, then answer", async () => {
    const sessions = manager();
    const brain = new FakeBrain(null);
    const sup = new Supervisor(sessions, brain, { enabled: false, defaultPolicy: "assist", intervalMs: 100_000 });
    const chat = new ControlChat(brain, sessions, sup, { cwdRoot: os.tmpdir() });
    brain.completions = [
      JSON.stringify({ tool: "list_sessions", args: {} }),
      JSON.stringify({ tool: "create_session", args: { preset: "custom", command: "echo from-chat", cwd: os.tmpdir(), name: "chatty" } }),
      JSON.stringify({ final: "세션을 만들었습니다." }),
    ];
    const turn = await chat.send("세션 하나 만들어줘");
    expect(turn.text).toBe("세션을 만들었습니다.");
    expect(turn.actions?.map((a) => a.tool)).toEqual(["list_sessions", "create_session"]);
    expect(sessions.list().some((s) => s.name === "chatty")).toBe(true);
    expect(sup.recentEvents(10).some((e) => e.actor === "chat")).toBe(true);
    sessions.killAll();
  });

  it("refuses dangerous input without explicit confirmation and allows it with it", async () => {
    const sessions = manager();
    const brain = new FakeBrain(null);
    const sup = new Supervisor(sessions, brain, { enabled: false, defaultPolicy: "assist", intervalMs: 100_000 });
    const chat = new ControlChat(brain, sessions, sup, { cwdRoot: os.tmpdir() });
    const s = sessions.create({ preset: "custom", command: isWin ? "cmd.exe /q /k" : "cat", cwd: os.tmpdir() });
    brain.completions = [JSON.stringify({ tool: "send_input", args: { id: s.id, text: "git push --force" } }), JSON.stringify({ final: "ok" })];
    const t1 = await chat.send("강제 푸시해");
    expect(t1.actions?.[0].result).toMatch(/거부/);
    brain.completions = [JSON.stringify({ tool: "send_input", args: { id: s.id, text: "echo confirmed-danger" } }), JSON.stringify({ final: "ok" })];
    const t2 = await chat.send("확인, 실행해", true);
    expect(t2.actions?.[0].result).toMatch(/전송됨/);
    sessions.killAll();
  });

  it("rejects list_dirs outside the root", async () => {
    const sessions = manager();
    const brain = new FakeBrain(null);
    const sup = new Supervisor(sessions, brain, { enabled: false, defaultPolicy: "assist", intervalMs: 100_000 });
    const chat = new ControlChat(brain, sessions, sup, { cwdRoot: os.tmpdir() });
    brain.completions = [JSON.stringify({ tool: "list_dirs", args: { path: isWin ? "C:\\Windows" : "/" } }), JSON.stringify({ final: "ok" })];
    const turn = await chat.send("시스템 폴더 보여줘");
    expect(turn.text).toMatch(/오류|루트/);
  });
});
