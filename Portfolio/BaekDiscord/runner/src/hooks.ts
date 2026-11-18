import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentKind, AgentState, SessionMode } from "./protocol.js";
import { detectDangerText } from "./danger.js";
import { redactSecrets } from "./security.js";

/**
 * Claude Code hooks as a state signal (docs/designs/devhub-control.md, 2절).
 *
 * The runner starts an interactive Claude session with `--settings <file>`; the file registers one
 * small script (runner/bin/devhub-hook.mjs) for the events below, all `async` so a hook never holds
 * Claude back. The script posts the payload to `POST /runner/hooks`. Hooks only report: a permission
 * prompt is still answered by typing into the terminal, never through hook output. PreToolUse is
 * left out on purpose (it blocks the tool while it runs).
 */
export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "Notification", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const HOOK_SESSION_HEADER = "x-devhub-session";
export const HOOK_SECRET_HEADER = "x-devhub-hook-secret";

function firstWord(command: string): string {
  const m = command.trim().match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  const word = m ? (m[1] ?? m[2] ?? m[3]) : "";
  return path
    .basename(word.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/** Which CLI a command line starts and whether it is a conversation. Read from the command, not the preset name. */
export function detectAgent(command: string, mode: SessionMode): { agent: AgentKind; interactive: boolean } {
  const bin = firstWord(command);
  const rest = command.trim().split(/\s+/).slice(1);
  if (bin === "claude") return { agent: "claude", interactive: mode === "pty" && !rest.some((a) => a === "-p" || a === "--print") };
  if (bin === "codex") return { agent: "codex", interactive: mode === "pty" && rest[0] !== "exec" };
  if (["powershell", "pwsh", "bash", "sh", "zsh", "cmd", "fish"].includes(bin)) return { agent: "shell", interactive: mode === "pty" };
  return { agent: "custom", interactive: mode === "pty" };
}

/**
 * Hooks are attached only to a plain interactive `claude ...` line. A command that brings its own
 * `--settings`, or chains other commands, is left alone and its state stays an output estimate.
 */
export function canInjectHooks(command: string, mode: SessionMode): boolean {
  const { agent, interactive } = detectAgent(command, mode);
  if (agent !== "claude" || !interactive) return false;
  if (/(^|\s)--settings(\s|=|$)/.test(command)) return false;
  return !/[&|;<>`\n]|\$\(/.test(command);
}

const slash = (p: string): string => p.replace(/\\/g, "/");

/** The settings object passed with `--settings`. Claude Code merges it with the user's own settings. */
export function hookSettings(nodePath: string, scriptPath: string): { hooks: Record<string, unknown[]> } {
  // Forward slashes: the line runs under cmd on some setups and Git Bash on others.
  const command = `"${slash(nodePath)}" "${slash(scriptPath)}"`;
  const entry = [{ hooks: [{ type: "command", command, async: true, timeout: 10 }] }];
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, entry])) };
}

export function writeHookSettings(dir: string, sessionId: string, nodePath: string, scriptPath: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(hookSettings(nodePath, scriptPath), null, 2), "utf8");
  return file;
}

export function withHookSettings(command: string, settingsFile: string): string {
  return `${command.trim()} --settings "${slash(settingsFile)}"`;
}

/** One hook call, reduced to what the runner uses. */
export interface HookSignal {
  /** Made by the hook script per call; the same id is handled once. */
  id: string;
  /** When the hook script started (async hooks can arrive out of order). */
  ts: number;
  event: HookEvent | "SessionEnd";
  claudeSessionId: string | null;
  promptId: string | null;
  tool: string | null;
  toolInput: Record<string, unknown> | null;
  notificationType: string | null;
}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** Validate what the hook script posted: `{ id, ts, payload }`. Returns null when it is not a hook call. */
export function parseHookBody(body: unknown): HookSignal | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { id?: unknown; ts?: unknown; payload?: unknown };
  const id = str(b.id, 64);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (typeof b.ts !== "number" || !Number.isFinite(b.ts)) return null;
  if (!b.payload || typeof b.payload !== "object") return null;
  const p = b.payload as Record<string, unknown>;
  const event = str(p.hook_event_name, 40);
  if (!event || (event !== "SessionEnd" && !(HOOK_EVENTS as readonly string[]).includes(event))) return null;
  const input = p.tool_input && typeof p.tool_input === "object" && !Array.isArray(p.tool_input) ? (p.tool_input as Record<string, unknown>) : null;
  return {
    id,
    ts: b.ts,
    event: event as HookSignal["event"],
    claudeSessionId: str(p.session_id, 100),
    promptId: str(p.prompt_id, 100),
    tool: str(p.tool_name, 100),
    toolInput: input,
    notificationType: str(p.notification_type, 60),
  };
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Read"]);

/** The part of a tool input a person needs to see to decide, and the text the danger table reads. */
export function toolInputSummary(tool: string | null, input: Record<string, unknown> | null): string {
  if (!input) return "";
  if (tool === "Bash" || tool === "PowerShell") return String(input.command ?? "");
  if (tool && FILE_TOOLS.has(tool)) return String(input.file_path ?? input.notebook_path ?? input.path ?? "");
  if (typeof input.url === "string") return input.url;
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

/** Joins a permission request to later records: PermissionRequest carries no tool_use_id. */
export function toolInputHash(input: Record<string, unknown> | null): string | null {
  if (!input) return null;
  try {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}

/** What the hooks last told us about a session. */
export interface HookPhase {
  kind: "idle" | "working" | "permission" | "turn_end";
  state: AgentState;
  reason: string;
  danger: boolean;
  dangerReason: string | null;
  tool: string | null;
  inputHash: string | null;
  promptId: string | null;
  ts: number;
}

const base = (sig: HookSignal) => ({ danger: false, dangerReason: null, tool: null, inputHash: null, promptId: sig.promptId, ts: sig.ts });

/**
 * Next phase after one signal, or null when the signal changes nothing. A signal older than the
 * current phase is ignored, so late async hooks cannot roll the state back.
 */
export function nextHookPhase(prev: HookPhase | null, sig: HookSignal): HookPhase | null {
  if (prev && sig.ts < prev.ts) return null;
  const waiting = prev?.state === "waiting_input";
  switch (sig.event) {
    case "SessionStart":
      // A restart inside the conversation (/clear, compaction, resume) keeps what we already know.
      return prev ? null : { ...base(sig), kind: "idle", state: "idle", reason: "지시 대기" };
    case "UserPromptSubmit":
    case "PostToolUse":
      return prev?.kind === "working" ? { ...prev, ts: sig.ts } : { ...base(sig), kind: "working", state: "working", reason: "작업 중" };
    case "PermissionRequest": {
      const summary = toolInputSummary(sig.tool, sig.toolInput);
      const d = detectDangerText(summary.slice(0, 4000));
      const shown = redactSecrets(summary.replace(/\s+/g, " ")).slice(0, 120);
      return {
        ...base(sig),
        kind: "permission",
        state: "waiting_input",
        reason: `권한 요청: ${sig.tool ?? "도구"}${shown ? ` · ${shown}` : ""}`,
        danger: d.danger,
        dangerReason: d.reason,
        tool: sig.tool,
        inputHash: toolInputHash(sig.toolInput),
      };
    }
    case "Notification":
      if (sig.notificationType === "permission_prompt") return prev?.kind === "permission" ? null : { ...base(sig), kind: "permission", state: "waiting_input", reason: "권한 요청" };
      // idle_prompt comes about a minute after the last answer: only useful when Stop was missed.
      if (sig.notificationType === "idle_prompt") return waiting ? null : { ...base(sig), kind: "turn_end", state: "waiting_input", reason: "응답 끝, 다음 지시 대기" };
      return null;
    case "Stop":
      return { ...base(sig), kind: "turn_end", state: "waiting_input", reason: "응답 끝, 다음 지시 대기" };
    default:
      return null;
  }
}

/** True when what a person (or the supervisor) typed answers a permission prompt. */
export function answersPermission(data: string): boolean {
  return /[\r\n\u001b\u0003]/.test(data) || /^[1-9yn]$/i.test(data);
}
