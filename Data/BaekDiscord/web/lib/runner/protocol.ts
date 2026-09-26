/**
 * Wire protocol between the DevHub web dashboard and the local runner.
 * Keep this file in sync with runner/src/protocol.ts (this file is a verbatim copy).
 */

export type SessionMode = "pty" | "pipe";
export type SessionStatus = "running" | "exited" | "killed" | "error";

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
  | { type: "presets" };

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
