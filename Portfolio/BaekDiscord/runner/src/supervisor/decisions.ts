import { randomUUID } from "node:crypto";
import type { AgentState, DecisionMetrics, Policy, SessionMode, SessionStatus, Suggestion } from "../protocol.js";
import { redactSecrets } from "../security.js";
import { JsonlLog } from "../store/files.js";
import { heuristicSuggestion, judgeHeuristically, type HeuristicInput, type Judgment } from "./heuristics.js";

/**
 * Decision records (devhub-next-20261113.md, 판단 기록). One line per judgment while a session waits
 * for input, then one outcome line when a person (or the session) answers. Append-only and never
 * rotated: these records are the golden set for `npm run eval:supervisor`.
 */
export interface DecisionRecord {
  type: "decision";
  v: 1;
  id: string;
  ts: number;
  sessionId: string;
  preset: string;
  policy: Policy;
  goal: string | null;
  /** Where the state came from: the output tail (an estimate) or a Claude Code hook (certain). */
  signal: "tail" | "hook";
  /**
   * Hook records only. PermissionRequest has no tool_use_id, so these four values are the key that
   * ties a request to other records of the same call.
   */
  hook?: { claudeSessionId: string | null; promptId: string | null; tool: string | null; inputHash: string | null };
  waitingSince: number | null;
  judgment: { state: AgentState; reason: string; promptKind: string | null; danger: boolean; dangerReason: string | null };
  /** The heuristic's inputs, masked, so the heuristic can be re-run on this record. */
  input: { tail: string[]; lastOutputAt: number | null; createdAt: number; now: number; status: SessionStatus; exitCode: number | null; mode: SessionMode };
  engine: { kind: string; model: string | null; runner: string; promptHash: string | null };
  proposal: { kind: Suggestion["kind"]; input?: string; confidence: number; source: Suggestion["source"] } | null;
  /** The engine considered this safe to send on its own (policy aside). */
  wouldAuto: boolean;
  autoSent: boolean;
}

export type OutcomeKind = "approved" | "dismissed" | "typed" | "reverted";

export interface OutcomeRecord {
  type: "outcome";
  decisionId: string;
  ts: number;
  kind: OutcomeKind;
  /** What the person typed (cut to 200 chars). null when not stored: the prompt asked for a secret. */
  input?: string | null;
  latencyMs: number | null;
}

export type LogRecord = DecisionRecord | OutcomeRecord;

/** Below this many samples a rate is not shown, only "표본 부족". */
export const MIN_SAMPLES = 50;
/** An autonomous answer undone this soon by a person counts as an incident. */
export const REVERT_WINDOW_MS = 5 * 60_000;
/** A wait left unanswered longer than this counts as a missed wait. */
export const MISSED_WAIT_MS = 5 * 60_000;
const TYPED_MAX = 200;

const SECRET_PROMPT = /(password|passphrase|passcode|token|api[ _-]?key|secret|otp|2fa|pin|비밀번호|암호|인증\s*번호)[^\n]{0,20}[:：?]?\s*$/i;

/** True when the last visible line asks for a secret: the person's answer is then not stored. */
export function asksForSecret(tail: string[]): boolean {
  const last = [...tail].reverse().find((l) => l.trim());
  return last ? SECRET_PROMPT.test(last.trim()) : false;
}

/** Comparison form of an answer: trimmed, lower case, `yes` = `y`, empty = Enter. */
export function normalizeAnswer(s: string): string {
  const t = s.replace(/[\r\n]+/g, " ").trim().toLowerCase();
  if (t === "" ) return "<enter>";
  if (t === "yes") return "y";
  if (t === "no") return "n";
  if (/^\d+$/.test(t)) return String(Number(t));
  return t;
}

export function maskTail(tail: string[]): string[] {
  return tail.slice(-40).map((l) => redactSecrets(l.length > 300 ? `${l.slice(0, 300)}…` : l));
}

export interface DecisionInput {
  session: { id: string; preset: string; policy: Policy; goal: string | null; mode: SessionMode; status: SessionStatus; exitCode: number | null; createdAt: number; lastOutputAt: number | null };
  judgment: Judgment;
  tail: string[];
  now: number;
  waitingSince: number | null;
  signal?: DecisionRecord["signal"];
  hook?: DecisionRecord["hook"] | null;
  engine: DecisionRecord["engine"];
  proposal: Omit<Suggestion, "id" | "createdAt"> | null;
  wouldAuto: boolean;
  autoSent: boolean;
}

export function buildDecision(d: DecisionInput): DecisionRecord {
  const s = d.session;
  return {
    type: "decision",
    v: 1,
    id: randomUUID().slice(0, 12),
    ts: d.now,
    sessionId: s.id,
    preset: s.preset,
    policy: s.policy,
    goal: s.goal ? redactSecrets(s.goal).slice(0, 300) : null,
    signal: d.signal ?? "tail",
    ...(d.hook ? { hook: d.hook } : {}),
    waitingSince: d.waitingSince,
    judgment: { state: d.judgment.state, reason: d.judgment.reason, promptKind: d.judgment.prompt?.kind ?? null, danger: d.judgment.danger, dangerReason: d.judgment.dangerReason },
    input: { tail: maskTail(d.tail), lastOutputAt: s.lastOutputAt, createdAt: s.createdAt, now: d.now, status: s.status, exitCode: s.exitCode, mode: s.mode },
    engine: d.engine,
    proposal: d.proposal
      ? { kind: d.proposal.kind, ...(d.proposal.input !== undefined ? { input: redactSecrets(d.proposal.input) } : {}), confidence: d.proposal.confidence, source: d.proposal.source }
      : null,
    wouldAuto: d.wouldAuto,
    autoSent: d.autoSent,
  };
}

export interface Joined {
  d: DecisionRecord;
  o: OutcomeRecord | null;
}

export function join(records: LogRecord[]): Joined[] {
  const byId = new Map<string, Joined>();
  for (const r of records) {
    if (r.type === "decision") byId.set(r.id, { d: r, o: null });
    else if (r.type === "outcome") {
      const j = byId.get(r.decisionId);
      if (j && !j.o) j.o = r;
    }
  }
  return [...byId.values()];
}

export function rate(hit: number, total: number): { hit: number; total: number; rate: number | null; enough: boolean } {
  return { hit, total, rate: total ? hit / total : null, enough: total >= MIN_SAMPLES };
}

export function sameAnswer(proposal: string | undefined, o: OutcomeRecord): boolean | null {
  if (o.kind === "approved") return true;
  if (o.kind === "dismissed") return false;
  if (o.kind === "typed") return o.input == null || proposal === undefined ? null : normalizeAnswer(o.input) === normalizeAnswer(proposal);
  return null;
}

/** The numbers shown on the control screen and printed by eval:supervisor, always with denominators. */
export function computeMetrics(records: LogRecord[], now = Date.now()): DecisionMetrics {
  const rows = join(records);
  const human = rows.filter((r) => r.o && r.o.kind !== "reverted" && !r.d.autoSent);

  // (1) Of the answers the engine proposed, how many did the person approve as is.
  const proposed = human.filter((r) => r.d.proposal?.kind === "respond");
  const approval = rate(proposed.filter((r) => r.o!.kind === "approved").length, proposed.length);

  // (2) Of the cases the engine would have sent by itself, how often the person's answer matched.
  // Only cases a person answered count (policy suggest/assist); auto-sent ones have no human answer.
  let match = 0;
  let judged = 0;
  let undetermined = 0;
  for (const r of human.filter((x) => x.d.wouldAuto)) {
    const same = sameAnswer(r.d.proposal?.input, r.o!);
    if (same === null) undetermined += 1;
    else {
      judged += 1;
      if (same) match += 1;
    }
  }
  const autoAgreement = { ...rate(match, judged), undetermined };

  const waits = rows.filter((r) => r.o && r.o.kind !== "reverted" && r.o.latencyMs !== null).map((r) => r.o!.latencyMs as number).sort((a, b) => a - b);
  const median = waits.length ? waits[Math.floor((waits.length - 1) / 2)] : null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const interventionsToday = rows.filter((r) => r.o && r.o.kind !== "reverted" && r.o.ts >= midnight.getTime()).length;
  const autoReverted = rows.filter((r) => r.o?.kind === "reverted").length;
  const missedWaits = waits.filter((ms) => ms > MISSED_WAIT_MS).length;

  return {
    decisions: rows.length,
    answered: human.length,
    approval,
    autoAgreement,
    waitMedianMs: median,
    waitSamples: waits.length,
    interventionsToday,
    incidents: { autoReverted, missedWaits },
    autoSent: rows.filter((r) => r.d.autoSent).length,
  };
}

/** Re-run today's heuristic on stored inputs and score it against what the person actually did. */
export function replayHeuristic(records: LogRecord[]): { replayed: number; changed: number; agreement: ReturnType<typeof rate> & { undetermined: number } } {
  let replayed = 0;
  let changed = 0;
  let hit = 0;
  let judged = 0;
  let undetermined = 0;
  for (const r of join(records)) {
    // A hook record's state did not come from the tail, so re-reading the tail says nothing about it.
    if (r.d.signal === "hook") continue;
    const input: HeuristicInput = { ...r.d.input, preset: r.d.preset };
    const sug = heuristicSuggestion(judgeHeuristically(input));
    replayed += 1;
    if (r.d.engine.kind === "heuristic" && (sug?.input ?? null) !== (r.d.proposal?.input ?? null)) changed += 1;
    if (!r.o || r.o.kind === "reverted" || r.d.autoSent || sug?.kind !== "respond") continue;
    const same = sameAnswer(sug.input, r.o);
    if (same === null) undetermined += 1;
    else {
      judged += 1;
      if (same) hit += 1;
    }
  }
  return { replayed, changed, agreement: { ...rate(hit, judged), undetermined } };
}

/**
 * The live log: writes records, keeps them in memory for metrics, and turns a person's keystrokes
 * into one outcome per answer (terminals send input a key at a time).
 */
export class DecisionLog {
  private records: LogRecord[] = [];
  private open = new Map<string, { d: DecisionRecord; typed: string; secret: boolean }>();
  private writeFailed = false;
  private cached: DecisionMetrics | null = null;
  /** Called after each record is kept, so the control screen can refresh its numbers. */
  onWrite: (() => void) | null = null;

  constructor(
    private log: JsonlLog<LogRecord>,
    private onError: (message: string) => void,
    private now: () => number = Date.now,
  ) {
    this.records = log.open().slice(-20_000);
  }

  get file(): string {
    return this.log.file;
  }

  metrics(): DecisionMetrics & { writeError: boolean } {
    this.cached ??= computeMetrics(this.records, this.now());
    return { ...this.cached, writeError: this.writeFailed };
  }

  private write(r: LogRecord): void {
    this.records.push(r);
    if (this.records.length > 20_000) this.records.splice(0, this.records.length - 20_000);
    this.cached = null;
    try {
      this.log.append(r);
      this.writeFailed = false;
    } catch (e) {
      // Shown once per failure streak, with the path and OS code so it can be fixed.
      if (!this.writeFailed) this.onError(`판단 기록 쓰기 실패: ${this.log.file} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
      this.writeFailed = true;
    }
    this.onWrite?.();
  }

  record(input: DecisionInput): DecisionRecord {
    this.flush(input.session.id);
    const d = buildDecision(input);
    this.write(d);
    if (!d.autoSent) this.open.set(d.sessionId, { d, typed: "", secret: asksForSecret(input.tail) });
    else this.open.set(d.sessionId, { d, typed: "", secret: true });
    return d;
  }

  /** A person approved or dismissed the pending suggestion. */
  verdict(sessionId: string, kind: "approved" | "dismissed"): void {
    const o = this.open.get(sessionId);
    if (!o || o.d.autoSent) return;
    this.open.delete(sessionId);
    this.outcome(o.d, kind, kind === "approved" ? (o.d.proposal?.input ?? null) : undefined);
  }

  /** A person typed into the session. Finishes the answer on Enter, Esc or Ctrl+C. */
  humanInput(sessionId: string, data: string): void {
    const o = this.open.get(sessionId);
    if (!o) return;
    if (o.d.autoSent) {
      // Interrupting right after an autonomous answer means the person undid it.
      if (/[\u0003\u001b]/.test(data) && this.now() - o.d.ts <= REVERT_WINDOW_MS) {
        this.open.delete(sessionId);
        this.outcome(o.d, "reverted");
      }
      return;
    }
    o.typed += data;
    if (/[\r\n\u0003\u001b]/.test(data)) this.flush(sessionId);
  }

  /** A person killed the session: right after an autonomous answer that is a revert. */
  humanKill(sessionId: string): void {
    const o = this.open.get(sessionId);
    if (!o) return;
    this.open.delete(sessionId);
    if (o.d.autoSent && this.now() - o.d.ts <= REVERT_WINDOW_MS) this.outcome(o.d, "reverted");
  }

  /** The session left the waiting state: close what the person typed so far, if anything. */
  flush(sessionId: string): void {
    const o = this.open.get(sessionId);
    if (!o) return;
    if (o.d.autoSent) {
      if (this.now() - o.d.ts > REVERT_WINDOW_MS) this.open.delete(sessionId);
      return;
    }
    if (!o.typed) return;
    this.open.delete(sessionId);
    const text = o.typed.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
    this.outcome(o.d, "typed", o.secret ? null : redactSecrets(text).slice(0, TYPED_MAX));
  }

  private outcome(d: DecisionRecord, kind: OutcomeKind, input?: string | null): void {
    const ts = this.now();
    const since = d.waitingSince ?? d.ts;
    this.write({ type: "outcome", decisionId: d.id, ts, kind, ...(input !== undefined ? { input } : {}), latencyMs: kind === "reverted" ? null : Math.max(0, ts - since) });
  }
}
