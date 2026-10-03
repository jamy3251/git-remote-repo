/**
 * Wire protocol between the DevHub web dashboard and the local runner.
 * Keep this file in sync with web/lib/runner/protocol.ts (this file is a verbatim copy).
 */

export type SessionMode = "pty" | "pipe";
export type SessionStatus = "running" | "exited" | "killed" | "error";

/** What the supervisor believes the agent is doing right now. */
export type AgentState = "starting" | "working" | "waiting_input" | "idle" | "error" | "done" | "killed";

/**
 * How much the supervisor may do on its own for a session.
 * manual: observe only. assist: observe + propose, a human approves. auto: act within the safety rules.
 */
export type Policy = "manual" | "assist" | "auto";

export interface Suggestion {
  id: string;
  createdAt: number;
  /** respond = send `input` to the session; escalate = needs a human; info = nothing to do. */
  kind: "respond" | "escalate" | "info";
  input?: string;
  label: string;
  rationale: string;
  confidence: number;
  source: "heuristic" | "brain";
}

export interface SessionInfo {
  id: string;
  name: string;
  preset: string;
  command: string;
  cwd: string;
  mode: SessionMode;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  createdAt: number;
  endedAt: number | null;
  /** bytes of output produced so far */
  bytes: number;
  tags: string[];
  /** Supervisor fields */
  goal: string | null;
  policy: Policy;
  state: AgentState;
  stateReason: string;
  lastOutputAt: number | null;
  /** Last line of output, ANSI-stripped, for list views. */
  lastLine: string;
  suggestion: Suggestion | null;
}

export interface PresetInfo {
  id: string;
  label: string;
  description: string;
  mode: SessionMode;
  /** Whether the preset accepts a free-form prompt (stdin in pipe mode). */
  acceptsPrompt: boolean;
  /** Whether the tool binary was found on PATH. */
  available: boolean;
}

export interface CreateSessionRequest {
  preset: string;
  /** Override the preset command (custom preset). */
  command?: string;
  cwd?: string;
  name?: string;
  /** For pipe-mode presets: written to stdin then closed. */
  prompt?: string;
  cols?: number;
  rows?: number;
  tags?: string[];
  goal?: string;
  policy?: Policy;
}

export interface SupervisorEvent {
  id: number;
  ts: number;
  sessionId: string | null;
  level: "info" | "warn" | "action" | "error";
  message: string;
  /** Who caused it: supervisor loop, a human in the dashboard, or the control chat. */
  actor: "supervisor" | "human" | "chat" | "system";
}

export interface SupervisorConfig {
  enabled: boolean;
  defaultPolicy: Policy;
  /** Which judgment backend is active. */
  brain: "api" | "claude-cli" | "heuristic";
  brainModel: string | null;
  notifyWebhook: boolean;
  /** Brain token accounting since the runner started. */
  usage: { brainCalls: number; brainErrors: number; inputTokens: number; outputTokens: number };
}

export interface GitFileChange {
  path: string;
  /** M, A, D, R, ?, etc. */
  status: string;
  insertions: number;
  deletions: number;
}

export interface GitSummary {
  repoRoot: string;
  branch: string;
  ahead: number;
  behind: number;
  changed: GitFileChange[];
  insertions: number;
  deletions: number;
  recentCommits: Array<{ sha: string; subject: string; when: string }>;
  checkedAt: number;
}

export interface WorkspaceInfo {
  id: string;
  cwd: string;
  git: GitSummary | null;
  /** Output bytes per 30-second bucket, oldest first (last 30 minutes). */
  activity: number[];
}

export interface TunnelStatus {
  provider: "ngrok" | "cloudflared" | null;
  available: { ngrok: boolean; cloudflared: boolean };
  state: "stopped" | "starting" | "running" | "error";
  url: string | null;
  /** SVG for a QR code that opens the dashboard on a phone with the token embedded. */
  qrSvg: string | null;
  error: string | null;
  startedAt: number | null;
}

export interface ChatAction {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  ts: number;
}

export type ClientMessage =
  | { type: "hello"; token: string }
  | { type: "list" }
  | { type: "create"; req: CreateSessionRequest; reqId?: string }
  | { type: "attach"; id: string }
  | { type: "detach"; id: string }
  | { type: "input"; ids: string[]; data: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "kill"; ids: string[] }
  | { type: "remove"; ids: string[] }
  | { type: "presets" }
  | { type: "set_goal"; id: string; goal: string | null }
  | { type: "set_policy"; id: string; policy: Policy }
  | { type: "suggestion"; id: string; suggestionId: string; decision: "approve" | "dismiss" }
  | { type: "events"; limit?: number }
  | { type: "supervisor"; enabled?: boolean; defaultPolicy?: Policy }
  | { type: "chat"; text: string; confirm?: boolean }
  | { type: "chat_history" }
  | { type: "chat_reset" }
  | { type: "tunnel"; action: "start" | "stop" | "status"; provider?: "ngrok" | "cloudflared" }
  | { type: "workspace"; id: string };

export type ServerMessage =
  | { type: "welcome"; runner: { version: string; platform: string; cwdRoot: string } }
  | { type: "sessions"; sessions: SessionInfo[] }
  | { type: "presets"; presets: PresetInfo[] }
  | { type: "created"; session: SessionInfo; reqId?: string }
  | { type: "updated"; session: SessionInfo }
  | { type: "removed"; id: string }
  | { type: "output"; id: string; data: string }
  | { type: "history"; id: string; data: string }
  | { type: "exit"; id: string; exitCode: number | null; status: SessionStatus }
  | { type: "event"; event: SupervisorEvent }
  | { type: "events"; events: SupervisorEvent[] }
  | { type: "supervisor"; config: SupervisorConfig }
  | { type: "chat"; turn: ChatTurn }
  | { type: "chat_history"; turns: ChatTurn[]; busy: boolean }
  | { type: "chat_status"; busy: boolean }
  | { type: "tunnel"; status: TunnelStatus }
  | { type: "workspace"; info: WorkspaceInfo }
  | { type: "error"; message: string; reqId?: string };

export interface CompileRequest {
  language: string;
  code: string;
  stdin?: string;
  /** wall-clock limit for the run step, ms (default 5000, max 30000) */
  timeoutMs?: number;
}

export interface StepResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ms: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface CompileResponse {
  language: string;
  compile: StepResult | null;
  run: StepResult | null;
}

export interface LanguageInfo {
  id: string;
  label: string;
  extension: string;
  available: boolean;
  version: string | null;
  /** The file name the source is written to (e.g. Main.java). */
  fileName: string;
  template: string;
}
