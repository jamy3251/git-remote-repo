import { EventEmitter } from "node:events";
import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as pty from "node-pty";
import type { CreateSessionRequest, Policy, SessionInfo, SessionStatus } from "./protocol.js";
import { findPreset } from "./presets.js";
import { isWindows } from "./config.js";
import { tailLines } from "./supervisor/ansi.js";

interface Session {
  info: SessionInfo;
  proc: pty.IPty | ChildProcess | null;
  history: string[];
  historyBytes: number;
}

export interface SessionManagerOptions {
  cwdRoot: string;
  maxSessions: number;
  historyBytes: number;
  defaultPolicy: Policy;
}

/**
 * Wrap a command line in the platform shell. On Windows the PTY path receives a
 * single verbatim string because node-pty re-quotes array arguments (which
 * breaks `cmd /c "..."`); the pipe path uses windowsVerbatimArguments instead.
 */
function shellWrap(command: string): { file: string; args: string[]; ptyArgs: string | string[] } {
  if (isWindows) {
    const line = `/d /s /c "${command}"`;
    return { file: "cmd.exe", args: [line], ptyArgs: line };
  }
  const args = ["-lc", command];
  return { file: "/bin/sh", args, ptyArgs: args };
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isPty(p: pty.IPty | ChildProcess): p is pty.IPty {
  return typeof (p as pty.IPty).onData === "function";
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  constructor(private opts: SessionManagerOptions) {
    super();
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  get(id: string): SessionInfo | undefined {
    const s = this.sessions.get(id);
    return s ? { ...s.info } : undefined;
  }

  history(id: string): string {
    return this.sessions.get(id)?.history.join("") ?? "";
  }

  resolveCwd(cwd?: string): string {
    const target = path.resolve(cwd ? cwd : this.opts.cwdRoot);
    if (!isInside(this.opts.cwdRoot, target)) {
      throw new Error(`cwd must be inside ${this.opts.cwdRoot}`);
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error(`cwd does not exist: ${target}`);
    }
    return target;
  }

  create(req: CreateSessionRequest): SessionInfo {
    const running = [...this.sessions.values()].filter((s) => s.info.status === "running").length;
    if (running >= this.opts.maxSessions) {
      throw new Error(`session limit reached (${this.opts.maxSessions})`);
    }
    const preset = findPreset(req.preset);
    if (!preset) throw new Error(`unknown preset: ${req.preset}`);
    const command = (preset.command || req.command || "").trim();
    if (!command) throw new Error("command is required for custom preset");
    const cwd = this.resolveCwd(req.cwd);
    const prompt = (req.prompt ?? "").trim();
    if (preset.acceptsPrompt && !prompt) throw new Error("prompt is required for this preset");

    const id = randomUUID().slice(0, 8);
    const info: SessionInfo = {
      id,
      name: req.name?.trim() || `${preset.id}-${id}`,
      preset: preset.id,
      command,
      cwd,
      mode: preset.mode,
      status: "running",
      pid: null,
      exitCode: null,
      createdAt: Date.now(),
      endedAt: null,
      bytes: 0,
      tags: req.tags ?? [],
      goal: req.goal?.trim() || null,
      policy: req.policy ?? this.opts.defaultPolicy,
      state: "starting",
      stateReason: "시작 중",
      lastOutputAt: null,
      lastLine: "",
      suggestion: null,
    };
    const session: Session = { info, proc: null, history: [], historyBytes: 0 };
    this.sessions.set(id, session);

    const env = { ...process.env, DEVHUB_SESSION: id, TERM: "xterm-256color", FORCE_COLOR: "1" } as Record<string, string>;
    const { file, args, ptyArgs } = shellWrap(command);

    try {
      if (preset.mode === "pty") {
        const p = pty.spawn(file, ptyArgs, {
          name: "xterm-256color",
          cols: req.cols ?? 100,
          rows: req.rows ?? 30,
          cwd,
          env,
          useConpty: isWindows,
        });
        session.proc = p;
        info.pid = p.pid;
        p.onData((d) => this.push(session, d));
        p.onExit(({ exitCode }) => this.finish(session, exitCode));
      } else {
        const c = spawnChild(file, args, {
          cwd,
          env,
          windowsHide: true,
          windowsVerbatimArguments: isWindows,
          stdio: ["pipe", "pipe", "pipe"],
        });
        session.proc = c;
        info.pid = c.pid ?? null;
        c.stdout?.setEncoding("utf8");
        c.stderr?.setEncoding("utf8");
        const crlf = (d: string) => d.replace(/\r?\n/g, "\r\n");
        c.stdout?.on("data", (d: string) => this.push(session, crlf(d)));
        c.stderr?.on("data", (d: string) => this.push(session, crlf(d)));
        c.on("error", (e) => {
          this.push(session, `\r\n[runner] spawn error: ${e.message}\r\n`);
          this.finish(session, null, "error");
        });
        c.on("close", (code) => this.finish(session, code));
        if (preset.acceptsPrompt) {
          const firstLine = prompt.split("\n")[0].slice(0, 120);
          const more = prompt.includes("\n") || prompt.length > 120 ? " …" : "";
          this.push(session, `[runner] > ${firstLine}${more}\r\n`);
          c.stdin?.end(prompt);
        } else {
          c.stdin?.end();
        }
      }
    } catch (e) {
      info.status = "error";
      info.endedAt = Date.now();
      this.push(session, `\r\n[runner] ${(e as Error).message}\r\n`);
      throw e;
    }
    this.emit("updated", { ...info });
    return { ...info };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s || s.info.status !== "running" || !s.proc) return;
    if (isPty(s.proc)) s.proc.write(data);
    else s.proc.stdin?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || !s.proc || !isPty(s.proc) || s.info.status !== "running") return;
    if (cols > 0 && rows > 0 && cols < 1000 && rows < 1000) {
      try {
        s.proc.resize(cols, rows);
      } catch {
        /* the pty exited between the status check and the resize */
      }
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s || !s.proc || s.info.status !== "running") return;
    s.info.status = "killed";
    const pid = s.info.pid;
    if (isWindows && pid) {
      spawnChild("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }).on("close", () => {
        if (!s.info.endedAt) this.finish(s, null, "killed");
      });
    } else if (isPty(s.proc)) {
      s.proc.kill();
    } else {
      s.proc.kill("SIGTERM");
    }
  }

  remove(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.info.status === "running") this.kill(id);
    this.sessions.delete(id);
    this.emit("removed", id);
  }

  killAll(): void {
    for (const id of this.sessions.keys()) this.kill(id);
  }

  /** Partial update of supervisor-owned fields; broadcasts "updated". */
  patch(id: string, partial: Partial<Pick<SessionInfo, "goal" | "policy" | "state" | "stateReason" | "suggestion" | "name" | "tags">>): SessionInfo | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    Object.assign(s.info, partial);
    this.emit("updated", { ...s.info });
    return { ...s.info };
  }

  /** Last `n` non-empty ANSI-stripped lines of a session's output. */
  tail(id: string, n: number): string[] {
    return tailLines(this.history(id), n);
  }

  private push(s: Session, data: string): void {
    s.info.bytes += Buffer.byteLength(data);
    s.info.lastOutputAt = Date.now();
    const lines = tailLines(data, 1);
    if (lines.length) s.info.lastLine = lines[0].slice(0, 200);
    s.history.push(data);
    s.historyBytes += data.length;
    while (s.historyBytes > this.opts.historyBytes && s.history.length > 1) {
      const dropped = s.history.shift() as string;
      s.historyBytes -= dropped.length;
    }
    this.emit("output", s.info.id, data);
  }

  private finish(s: Session, exitCode: number | null, status?: SessionStatus): void {
    if (s.info.endedAt) return;
    s.info.exitCode = exitCode;
    s.info.status = status ?? (s.info.status === "killed" ? "killed" : "exited");
    s.info.endedAt = Date.now();
    const code = exitCode !== null ? ` (code ${exitCode})` : "";
    this.push(s, `\r\n[runner] process ${s.info.status}${code}\r\n`);
    this.emit("exit", s.info.id, exitCode, s.info.status);
    this.emit("updated", { ...s.info });
  }
}
