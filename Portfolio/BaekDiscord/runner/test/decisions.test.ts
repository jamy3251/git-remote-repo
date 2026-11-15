import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/sessions.js";
import { Supervisor } from "../src/supervisor/supervisor.js";
import type { Brain, BrainDecision } from "../src/supervisor/brain.js";
import { JsonlLog, readJsonl } from "../src/store/files.js";
import {
  DecisionLog,
  MIN_SAMPLES,
  asksForSecret,
  buildDecision,
  computeMetrics,
  normalizeAnswer,
  replayHeuristic,
  type DecisionInput,
  type LogRecord,
  type OutcomeRecord,
} from "../src/supervisor/decisions.js";
import type { Judgment } from "../src/supervisor/heuristics.js";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-dec-")), "decisions.jsonl");

const waiting: Judgment = { state: "waiting_input", reason: "y/n 질문", prompt: { kind: "yes_no" }, danger: false, dangerReason: null };

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    session: { id: "s1", preset: "custom", policy: "assist", goal: null, mode: "pty", status: "running", exitCode: null, createdAt: 0, lastOutputAt: 1_000 },
    judgment: waiting,
    tail: ["Overwrite config? (y/n)"],
    now: 20_000,
    waitingSince: 10_000,
    engine: { kind: "api", model: "fake", runner: "test", promptHash: "abc" },
    proposal: { kind: "respond", input: "y\r", label: "", rationale: "", confidence: 0.9, source: "brain" },
    wouldAuto: true,
    autoSent: false,
    ...over,
  };
}

function outcome(decisionId: string, kind: OutcomeRecord["kind"], extra: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return { type: "outcome", decisionId, ts: 30_000, kind, latencyMs: 20_000, ...extra };
}

describe("answer handling", () => {
  it("normalizes answers for comparison", () => {
    expect(normalizeAnswer("Y\r")).toBe("y");
    expect(normalizeAnswer(" yes ")).toBe("y");
    expect(normalizeAnswer("\r")).toBe("<enter>");
    expect(normalizeAnswer("01\r")).toBe("1");
  });

  it("recognizes prompts that ask for secrets", () => {
    expect(asksForSecret(["Enter password:"])).toBe(true);
    expect(asksForSecret(["", "API key: ", ""])).toBe(true);
    expect(asksForSecret(["비밀번호를 입력하세요:"])).toBe(true);
    expect(asksForSecret(["Overwrite? (y/n)"])).toBe(false);
  });

  it("masks secrets in the stored tail", () => {
    const d = buildDecision(input({ tail: ["export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "(y/n)"] }));
    expect(d.input.tail.join("\n")).not.toContain("abcdefghijklmnop");
  });
});

describe("computeMetrics", () => {
  it("reports sample shortage below the minimum, with denominators", () => {
    const d = buildDecision(input());
    const m = computeMetrics([d, outcome(d.id, "approved")]);
    expect(m.approval).toMatchObject({ hit: 1, total: 1, rate: 1, enough: false });
    expect(m.autoAgreement).toMatchObject({ hit: 1, total: 1, enough: false, undetermined: 0 });
    expect(m.answered).toBe(1);
  });

  it("scores approval and auto agreement over enough samples", () => {
    const recs: LogRecord[] = [];
    for (let i = 0; i < MIN_SAMPLES; i++) {
      const d = buildDecision(input());
      recs.push(d);
      // 40 approved, 5 typed the same answer, 3 typed something else, 2 typed a secret (not stored).
      if (i < 40) recs.push(outcome(d.id, "approved"));
      else if (i < 45) recs.push(outcome(d.id, "typed", { input: "Y\r" }));
      else if (i < 48) recs.push(outcome(d.id, "typed", { input: "n\r" }));
      else recs.push(outcome(d.id, "typed", { input: null }));
    }
    const m = computeMetrics(recs);
    expect(m.approval).toMatchObject({ hit: 40, total: 50, enough: true });
    expect(m.approval.rate).toBeCloseTo(0.8);
    expect(m.autoAgreement).toMatchObject({ hit: 45, total: 48, undetermined: 2 });
  });

  it("never counts auto-sent decisions as human answers, and counts reverts and missed waits", () => {
    const auto = buildDecision(input({ autoSent: true }));
    const slow = buildDecision(input());
    const m = computeMetrics([auto, outcome(auto.id, "reverted", { latencyMs: null }), slow, outcome(slow.id, "typed", { input: "y", latencyMs: 6 * 60_000 })]);
    expect(m.answered).toBe(1);
    expect(m.autoSent).toBe(1);
    expect(m.incidents).toEqual({ autoReverted: 1, missedWaits: 1 });
    expect(m.waitMedianMs).toBe(6 * 60_000);
  });
});

describe("replayHeuristic", () => {
  it("re-runs the heuristic on stored inputs", () => {
    const d = buildDecision(input({ engine: { kind: "heuristic", model: null, runner: "t", promptHash: null }, proposal: null, wouldAuto: false }));
    const r = replayHeuristic([d, outcome(d.id, "typed", { input: "y\r" })]);
    expect(r.replayed).toBe(1);
  });
});

describe("DecisionLog", () => {
  it("groups keystrokes into one typed answer and writes it to disk", () => {
    const file = tmpFile();
    let t = 50_000;
    const log = new DecisionLog(new JsonlLog<LogRecord>(file, { rotate: false }), () => {}, () => t);
    const d = log.record(input());
    log.humanInput("s1", "n");
    log.humanInput("s1", "o");
    t = 55_000;
    log.humanInput("s1", "\r");
    const recs = readJsonl<LogRecord>(file).records;
    expect(recs).toHaveLength(2);
    expect(recs[1]).toMatchObject({ type: "outcome", decisionId: d.id, kind: "typed", input: "no\r", latencyMs: 45_000 });
  });

  it("does not store what was typed at a secret prompt", () => {
    const file = tmpFile();
    const log = new DecisionLog(new JsonlLog<LogRecord>(file, { rotate: false }), () => {});
    log.record(input({ tail: ["Password:"] }));
    log.humanInput("s1", "hunter2\r");
    const o = readJsonl<LogRecord>(file).records[1] as OutcomeRecord;
    expect(o.input).toBeNull();
    expect(fs.readFileSync(file, "utf8")).not.toContain("hunter2");
  });

  it("marks Ctrl+C right after an autonomous answer as a revert", () => {
    const file = tmpFile();
    const log = new DecisionLog(new JsonlLog<LogRecord>(file, { rotate: false }), () => {}, () => 21_000);
    log.record(input({ autoSent: true }));
    log.humanInput("s1", "\u0003");
    expect((readJsonl<LogRecord>(file).records[1] as OutcomeRecord).kind).toBe("reverted");
    expect(log.metrics().incidents.autoReverted).toBe(1);
  });

  it("reports a write failure once, with the path", () => {
    const errors: string[] = [];
    const broken = new JsonlLog<LogRecord>(tmpFile(), { rotate: false });
    broken.append = () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const log = new DecisionLog(broken, (m) => errors.push(m));
    log.record(input());
    log.record(input());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/decisions\.jsonl.*EACCES/);
    expect(log.metrics().writeError).toBe(true);
  });
});

class FakeBrain implements Brain {
  kind = "api" as const;
  model = "fake";
  constructor(private decision: BrainDecision) {}
  async judge(): Promise<BrainDecision> {
    return this.decision;
  }
  async complete(): Promise<null> {
    return null;
  }
}

describe("Supervisor writes decision records", () => {
  const isWin = process.platform === "win32";
  const promptCommand = (text: string) => (isWin ? `cmd.exe /q /v:on /c "echo ${text}& set /p answer= & echo got !answer!"` : `sh -c 'echo "${text}"; read answer; echo got $answer'`);
  let sessions: SessionManager;
  afterEach(() => sessions.killAll());

  it("records the proposal and the human approval with its latency", async () => {
    sessions = new SessionManager({ cwdRoot: os.tmpdir(), maxSessions: 4, historyBytes: 64 * 1024, defaultPolicy: "assist" });
    const file = tmpFile();
    const decisions = new DecisionLog(new JsonlLog<LogRecord>(file, { rotate: false }), () => {});
    const brain = new FakeBrain({ state: "waiting_input", summary: "", action: "respond", input: "y\r", confidence: 0.9, rationale: "목표상 덮어써도 됨" });
    const sup = new Supervisor(sessions, brain, { enabled: true, defaultPolicy: "assist", intervalMs: 100_000, decisions, runnerVersion: "t" });
    const s = sessions.create({ preset: "custom", command: promptCommand("Overwrite? (y/n)"), cwd: os.tmpdir() });
    const until = Date.now() + 8000;
    while (!sessions.tail(s.id, 5).some((l) => l.includes("(y/n)"))) {
      if (Date.now() > until) throw new Error("timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
    await sup.tick(Date.now() + 10_000);
    const sug = sessions.get(s.id)?.suggestion;
    expect(sug?.kind).toBe("respond");
    sup.decide(s.id, sug!.id, "approve", "human");
    const recs = readJsonl<LogRecord>(file).records;
    expect(recs.map((r) => r.type)).toEqual(["decision", "outcome"]);
    expect(recs[0]).toMatchObject({ type: "decision", policy: "assist", wouldAuto: true, autoSent: false, engine: { kind: "api", model: "fake" } });
    expect(recs[1]).toMatchObject({ type: "outcome", kind: "approved", input: "y\r" });
    expect(sup.config().metrics?.approval).toMatchObject({ hit: 1, total: 1 });
  });
});
