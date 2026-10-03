import { spawn } from "node:child_process";
import type { AgentState } from "../protocol.js";
import { binaryAvailable } from "../presets.js";
import { isWindows } from "../config.js";
import type { Judgment } from "./heuristics.js";

export type BrainKind = "api" | "claude-cli" | "heuristic";

export interface BrainMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BrainJudgeInput {
  sessionName: string;
  preset: string;
  cwd: string;
  goal: string | null;
  tail: string[];
  heuristic: Judgment;
}

export interface BrainDecision {
  state: AgentState;
  summary: string;
  action: "respond" | "wait" | "escalate";
  input?: string;
  confidence: number;
  rationale: string;
}

export interface Brain {
  kind: BrainKind;
  model: string | null;
  /** Free-form completion used by the control chat. Returns null when no backend is available. */
  complete(system: string, messages: BrainMessage[]): Promise<string | null>;
  /** Structured judgment of one session. Returns null when no backend is available or parsing failed. */
  judge(input: BrainJudgeInput): Promise<BrainDecision | null>;
}

export interface BrainConfig {
  preference: "auto" | BrainKind;
  model: string | null;
  apiKey: string | null;
  cliTimeoutMs: number;
  /** Token accounting callback (input, output). */
  onUsage?: (inputTokens: number, outputTokens: number) => void;
}

const JUDGE_SYSTEM = `당신은 개발자의 PC에서 돌아가는 CLI 에이전트(Claude Code, Codex, 셸)들을 감독하는 관제 AI입니다.
세션의 최근 터미널 출력을 보고 상태를 판단하고, 입력을 기다리는 중이면 어떻게 응답할지 결정합니다.

규칙:
- 파일 삭제, force push, 배포, 비밀값 노출, 시스템 변경처럼 되돌리기 어려운 일은 절대 자동 응답하지 말고 escalate 하세요.
- 목표(goal)가 주어졌다면 그 목표에 맞는 선택만 respond 하세요. 목표가 없으면 안전한 기본 진행(Enter, 읽기 전용 허용)만 respond 하세요.
- 확신이 없으면 escalate. confidence는 0~1.
- input은 세션에 그대로 타이핑될 문자열입니다. Enter는 "\\r"로 표기하세요. 메뉴는 번호만("1") 또는 번호+"\\r".
- 반드시 아래 JSON 하나만 출력하세요. 설명 문장 금지.
{"state":"working|waiting_input|idle|error|done","summary":"한 줄 요약(한국어)","action":"respond|wait|escalate","input":"","confidence":0.0,"rationale":"한 줄 근거(한국어)"}`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in brain output");
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeDecision(raw: unknown): BrainDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const states: AgentState[] = ["starting", "working", "waiting_input", "idle", "error", "done", "killed"];
  const actions = ["respond", "wait", "escalate"] as const;
  const state = states.includes(r.state as AgentState) ? (r.state as AgentState) : "waiting_input";
  const action = actions.includes(r.action as (typeof actions)[number]) ? (r.action as BrainDecision["action"]) : "escalate";
  const confidence = Math.max(0, Math.min(1, Number(r.confidence ?? 0)));
  const input = typeof r.input === "string" ? r.input.replace(/\\r/g, "\r").replace(/\\n/g, "\n") : undefined;
  return {
    state,
    summary: String(r.summary ?? "").slice(0, 200),
    action,
    input: action === "respond" ? input : undefined,
    confidence,
    rationale: String(r.rationale ?? "").slice(0, 300),
  };
}

function judgePrompt(input: BrainJudgeInput): string {
  return [
    `세션: ${input.sessionName} (프리셋 ${input.preset}, 폴더 ${input.cwd})`,
    `목표: ${input.goal ?? "(없음)"}`,
    `규칙 기반 1차 판단: ${input.heuristic.state} — ${input.heuristic.reason}${input.heuristic.danger ? ` [위험 신호: ${input.heuristic.dangerReason}]` : ""}`,
    "",
    "최근 출력(오래된 것부터):",
    "```",
    ...input.tail.slice(-40),
    "```",
  ].join("\n");
}

class ApiBrain implements Brain {
  kind: BrainKind = "api";
  constructor(
    public model: string,
    private apiKey: string,
    private onUsage?: BrainConfig["onUsage"],
  ) {}

  private async client() {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey: this.apiKey });
  }

  async complete(system: string, messages: BrainMessage[]): Promise<string | null> {
    const client = await this.client();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      // The system prompt is identical across calls: cache it so repeated judgments pay ~10% for it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium" },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    this.onUsage?.(
      (response.usage.input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      response.usage.output_tokens ?? 0,
    );
    if (response.stop_reason === "refusal") return null;
    return response.content
      .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
  }

  async judge(input: BrainJudgeInput): Promise<BrainDecision | null> {
    const text = await this.complete(JUDGE_SYSTEM, [{ role: "user", content: judgePrompt(input) }]);
    return text ? normalizeDecision(extractJson(text)) : null;
  }
}

/** Uses the locally installed Claude Code CLI (`claude -p`) so no API key is needed. */
class ClaudeCliBrain implements Brain {
  kind: BrainKind = "claude-cli";
  model: string | null;
  constructor(
    model: string | null,
    private timeoutMs: number,
    private onUsage?: BrainConfig["onUsage"],
  ) {
    this.model = model;
  }

  async complete(system: string, messages: BrainMessage[]): Promise<string | null> {
    const transcript = messages.map((m) => `${m.role === "user" ? "[사용자]" : "[관제 AI]"}\n${m.content}`).join("\n\n");
    const prompt = `${system}\n\n---\n대화:\n${transcript}\n\n[관제 AI]\n`;
    const args = ["-p", "--output-format", "json"];
    if (this.model) args.push("--model", this.model);
    const file = isWindows ? "cmd.exe" : "claude";
    const fileArgs = isWindows ? ["/d", "/s", "/c", `claude ${args.join(" ")}`] : args;
    return new Promise((resolve, reject) => {
      const child = spawn(file, fileArgs, { windowsHide: true, windowsVerbatimArguments: isWindows, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("claude -p timed out"));
      }, this.timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => (out += d));
      child.stderr.on("data", (d: string) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !out) return reject(new Error(`claude -p exited ${code}: ${err.slice(0, 300)}`));
        try {
          const parsed = JSON.parse(out) as {
            result?: string;
            is_error?: boolean;
            usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
          };
          if (parsed.usage) {
            const u = parsed.usage;
            this.onUsage?.((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), u.output_tokens ?? 0);
          }
          if (parsed.is_error) return reject(new Error(String(parsed.result ?? "claude error")));
          resolve(typeof parsed.result === "string" ? parsed.result : out);
        } catch {
          resolve(out);
        }
      });
      child.stdin.end(prompt);
    });
  }

  async judge(input: BrainJudgeInput): Promise<BrainDecision | null> {
    const text = await this.complete(JUDGE_SYSTEM, [{ role: "user", content: judgePrompt(input) }]);
    return text ? normalizeDecision(extractJson(text)) : null;
  }
}

class NoBrain implements Brain {
  kind: BrainKind = "heuristic";
  model = null;
  async complete(): Promise<string | null> {
    return null;
  }
  async judge(): Promise<BrainDecision | null> {
    return null;
  }
}

export function createBrain(cfg: BrainConfig): Brain {
  const want = cfg.preference;
  if ((want === "auto" || want === "api") && cfg.apiKey) return new ApiBrain(cfg.model ?? "claude-opus-5", cfg.apiKey, cfg.onUsage);
  if (want === "api") return new NoBrain();
  if ((want === "auto" || want === "claude-cli") && binaryAvailable("claude")) return new ClaudeCliBrain(cfg.model, cfg.cliTimeoutMs, cfg.onUsage);
  return new NoBrain();
}

export { extractJson as parseBrainJson };
