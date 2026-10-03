import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import type { AgentState, Policy, SessionInfo, Suggestion, SupervisorConfig, SupervisorEvent } from "../protocol.js";
import type { SessionManager } from "../sessions.js";
import type { Brain, BrainDecision } from "./brain.js";
import { heuristicSuggestion, isSafeAutoInput, judgeHeuristically, type Judgment } from "./heuristics.js";
import { redactSecrets } from "../security.js";

export interface SupervisorOptions {
  enabled: boolean;
  defaultPolicy: Policy;
  intervalMs: number;
  notify?: ((text: string) => Promise<void>) | null;
  /** Minimum gap between two brain calls for the same session. */
  brainCooldownMs?: number;
  /** Bucket width for the activity sparkline. */
  activityBucketMs?: number;
}

interface Track {
  judgedHash: string | null;
  judgedAt: number;
  lastNotifyAt: number;
  activity: number[];
  bucketStart: number;
  bytesSeen: number;
}

export interface UsageTotals {
  brainCalls: number;
  brainErrors: number;
  inputTokens: number;
  outputTokens: number;
}

const ACTIVITY_BUCKETS = 60;

/** Compact the output tail for an LLM: dedupe consecutive repeats, drop box-drawing noise, cap size. */
export function compactTail(lines: string[], maxChars = 2400): string[] {
  const out: string[] = [];
  let prev = "";
  let repeats = 0;
  for (const raw of lines) {
    const line = raw.replace(/[─│╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝]+/g, " ").replace(/\s{3,}/g, "  ").trim();
    if (!line) continue;
    if (line === prev) {
      repeats += 1;
      continue;
    }
    if (repeats > 0) out.push(`(같은 줄 ${repeats}회 반복)`);
    repeats = 0;
    prev = line;
    out.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  }
  if (repeats > 0) out.push(`(같은 줄 ${repeats}회 반복)`);
  let total = 0;
  const kept: string[] = [];
  for (let i = out.length - 1; i >= 0; i--) {
    total += out[i].length + 1;
    if (total > maxChars) break;
    kept.unshift(out[i]);
  }
  return kept.map(redactSecrets);
}

export class Supervisor extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private tracks = new Map<string, Track>();
  private events: SupervisorEvent[] = [];
  private nextEventId = 1;
  private enabled: boolean;
  private defaultPolicy: Policy;
  private inflight = new Set<string>();
  usage: UsageTotals = { brainCalls: 0, brainErrors: 0, inputTokens: 0, outputTokens: 0 };

  constructor(
    private sessions: SessionManager,
    private brain: Brain,
    private opts: SupervisorOptions,
  ) {
    super();
    this.enabled = opts.enabled;
    this.defaultPolicy = opts.defaultPolicy;
    sessions.on("removed", (id: string) => this.tracks.delete(id));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs);
    this.timer.unref?.();
    this.log("info", null, "system", `슈퍼바이저 시작 (판단 엔진: ${this.brain.kind}${this.brain.model ? ` / ${this.brain.model}` : ""})`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  config(): SupervisorConfig {
    return {
      enabled: this.enabled,
      defaultPolicy: this.defaultPolicy,
      brain: this.brain.kind,
      brainModel: this.brain.model,
      notifyWebhook: Boolean(this.opts.notify),
      usage: { ...this.usage },
    };
  }

  setConfig(patch: { enabled?: boolean; defaultPolicy?: Policy }, actor: SupervisorEvent["actor"]): SupervisorConfig {
    if (patch.enabled !== undefined && patch.enabled !== this.enabled) {
      this.enabled = patch.enabled;
      this.log("action", null, actor, patch.enabled ? "슈퍼바이저 켬" : "슈퍼바이저 끔");
    }
    if (patch.defaultPolicy && patch.defaultPolicy !== this.defaultPolicy) {
      this.defaultPolicy = patch.defaultPolicy;
      this.log("action", null, actor, `기본 정책 → ${patch.defaultPolicy}`);
    }
    this.emit("config", this.config());
    return this.config();
  }

  recentEvents(limit = 200): SupervisorEvent[] {
    return this.events.slice(-Math.max(1, Math.min(limit, 1000)));
  }

  activity(id: string): number[] {
    return [...(this.tracks.get(id)?.activity ?? [])];
  }

  log(level: SupervisorEvent["level"], sessionId: string | null, actor: SupervisorEvent["actor"], message: string): SupervisorEvent {
    const event: SupervisorEvent = { id: this.nextEventId++, ts: Date.now(), sessionId, level, message: message.slice(0, 500), actor };
    this.events.push(event);
    if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
    this.emit("event", event);
    return event;
  }

  setGoal(id: string, goal: string | null, actor: SupervisorEvent["actor"]): SessionInfo | undefined {
    const s = this.sessions.patch(id, { goal: goal?.trim() || null });
    if (s) this.log("action", id, actor, goal ? `목표 설정: ${goal.slice(0, 120)}` : "목표 제거");
    this.invalidate(id);
    return s;
  }

  setPolicy(id: string, policy: Policy, actor: SupervisorEvent["actor"]): SessionInfo | undefined {
    const s = this.sessions.patch(id, { policy });
    if (s) this.log("action", id, actor, `정책 → ${policy}`);
    this.invalidate(id);
    return s;
  }

  /** Human/chat verdict on a pending suggestion. */
  decide(id: string, suggestionId: string, decision: "approve" | "dismiss", actor: SupervisorEvent["actor"]): SessionInfo | undefined {
    const s = this.sessions.get(id);
    if (!s || !s.suggestion || s.suggestion.id !== suggestionId) return s;
    const sug = s.suggestion;
    if (decision === "approve" && sug.kind === "respond" && sug.input !== undefined) {
      this.sessions.write(id, sug.input);
      this.log("action", id, actor, `제안 승인 → 입력 전송: ${describeInput(sug.input)} (${sug.label})`);
    } else {
      this.log("info", id, actor, `제안 ${decision === "approve" ? "확인" : "무시"}: ${sug.label}`);
    }
    this.invalidate(id);
    return this.sessions.patch(id, { suggestion: null });
  }

  private invalidate(id: string): void {
    const t = this.tracks.get(id);
    if (t) t.judgedHash = null;
  }

  private track(s: SessionInfo, now: number): Track {
    let t = this.tracks.get(s.id);
    if (!t) {
      t = { judgedHash: null, judgedAt: 0, lastNotifyAt: 0, activity: new Array(ACTIVITY_BUCKETS).fill(0), bucketStart: now, bytesSeen: 0 };
      this.tracks.set(s.id, t);
    }
    const width = this.opts.activityBucketMs ?? 30_000;
    const elapsedBuckets = Math.floor((now - t.bucketStart) / width);
    if (elapsedBuckets > 0) {
      for (let i = 0; i < Math.min(elapsedBuckets, ACTIVITY_BUCKETS); i++) {
        t.activity.push(0);
        t.activity.shift();
      }
      t.bucketStart += elapsedBuckets * width;
    }
    const delta = Math.max(0, s.bytes - t.bytesSeen);
    t.bytesSeen = s.bytes;
    t.activity[ACTIVITY_BUCKETS - 1] += delta;
    return t;
  }

  async tick(now = Date.now()): Promise<void> {
    for (const s of this.sessions.list()) {
      const t = this.track(s, now);
      if (!this.enabled) continue;
      const tail = this.sessions.tail(s.id, 40);
      const judgment = judgeHeuristically({
        tail,
        lastOutputAt: s.lastOutputAt,
        createdAt: s.createdAt,
        now,
        status: s.status,
        exitCode: s.exitCode,
        mode: s.mode,
        preset: s.preset,
      });
      await this.apply(s, judgment, tail, t, now);
    }
  }

  private async apply(s: SessionInfo, j: Judgment, tail: string[], t: Track, now: number): Promise<void> {
    const changed = j.state !== s.state;
    if (changed) {
      this.sessions.patch(s.id, { state: j.state, stateReason: j.reason, suggestion: j.state === "waiting_input" ? s.suggestion : null });
      const level = j.state === "error" ? "error" : j.state === "waiting_input" ? "warn" : "info";
      this.log(level, s.id, "supervisor", `${stateLabel(j.state)} — ${j.reason}`);
      if (j.state !== "waiting_input") t.judgedHash = null;
    } else if (j.reason !== s.stateReason) {
      this.sessions.patch(s.id, { stateReason: j.reason });
    }

    if (j.state !== "waiting_input" || s.policy === "manual") {
      if (changed && j.state === "waiting_input" && s.policy === "manual") void this.notify(s, t, now, `입력 대기: ${j.reason}`);
      return;
    }
    if (s.suggestion || this.inflight.has(s.id)) return;

    const hash = createHash("sha1").update(tail.slice(-15).join("\n")).digest("hex");
    if (t.judgedHash === hash) return;
    const cooldown = this.opts.brainCooldownMs ?? 30_000;
    if (now - t.judgedAt < cooldown && t.judgedHash !== null) return;
    t.judgedHash = hash;
    t.judgedAt = now;

    this.inflight.add(s.id);
    try {
      let decision: BrainDecision | null = null;
      if (this.brain.kind !== "heuristic" && !j.danger) {
        this.usage.brainCalls += 1;
        try {
          decision = await this.brain.judge({
            sessionName: s.name,
            preset: s.preset,
            cwd: s.cwd,
            goal: s.goal,
            tail: compactTail(tail),
            heuristic: j,
          });
        } catch (e) {
          this.usage.brainErrors += 1;
          this.log("error", s.id, "supervisor", `판단 엔진 오류: ${(e as Error).message.slice(0, 200)}`);
        }
      }
      const current = this.sessions.get(s.id);
      if (!current || current.state !== "waiting_input" || current.suggestion) return;

      const suggestion = decision ? fromDecision(decision, j) : heuristicSuggestion(j);
      if (!suggestion) return;
      const full: Suggestion = { ...suggestion, id: randomUUID().slice(0, 8), createdAt: Date.now() };

      const autoOk =
        current.policy === "auto" &&
        full.kind === "respond" &&
        full.input !== undefined &&
        !j.danger &&
        full.confidence >= 0.7 &&
        (full.source === "brain" || isSafeAutoInput(full.input));
      if (autoOk) {
        this.sessions.write(s.id, full.input as string);
        this.log("action", s.id, "supervisor", `자율 응답: ${describeInput(full.input as string)} — ${full.rationale} (신뢰도 ${full.confidence.toFixed(2)})`);
        return;
      }
      this.sessions.patch(s.id, { suggestion: full });
      this.log(full.kind === "escalate" ? "warn" : "info", s.id, "supervisor", `${full.kind === "escalate" ? "사람 확인 요청" : "제안"}: ${full.label} — ${full.rationale}`);
      void this.notify(s, t, now, `${full.kind === "escalate" ? "⚠️ 확인 필요" : "💡 제안"}: ${full.label}\n${full.rationale}`);
    } finally {
      this.inflight.delete(s.id);
    }
  }

  private async notify(s: SessionInfo, t: Track, now: number, text: string): Promise<void> {
    if (!this.opts.notify) return;
    if (now - t.lastNotifyAt < 60_000) return;
    t.lastNotifyAt = now;
    try {
      await this.opts.notify(redactSecrets(`[DevHub] ${s.name} (${s.preset})\n${text}`));
    } catch (e) {
      this.log("error", s.id, "system", `알림 실패: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

function fromDecision(d: BrainDecision, j: Judgment): Omit<Suggestion, "id" | "createdAt"> | null {
  if (d.action === "wait") return null;
  if (d.action === "respond" && d.input !== undefined && !j.danger) {
    return { kind: "respond", input: d.input, label: `응답 제안: ${describeInput(d.input)}`, rationale: d.rationale || d.summary, confidence: d.confidence, source: "brain" };
  }
  return {
    kind: "escalate",
    label: j.danger ? `사람 확인 필요 (${j.dangerReason})` : "사람 확인 필요",
    rationale: d.rationale || d.summary,
    confidence: d.confidence,
    source: "brain",
  };
}

export function describeInput(input: string): string {
  const shown = input.replace(/\r/g, "⏎").replace(/\n/g, "⏎").replace(/\u0003/g, "^C").replace(/\u001b/g, "Esc");
  return shown.length ? `"${shown.slice(0, 40)}"` : '""';
}

export function stateLabel(state: AgentState): string {
  return (
    {
      starting: "시작 중",
      working: "작업 중",
      waiting_input: "입력 대기",
      idle: "대기",
      error: "오류",
      done: "완료",
      killed: "종료됨",
    } as Record<AgentState, string>
  )[state];
}
