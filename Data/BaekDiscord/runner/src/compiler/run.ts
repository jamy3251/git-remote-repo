import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CompileRequest, CompileResponse, StepResult } from "../protocol.js";
import { isWindows } from "../config.js";
import { findLanguage, outputBinaryName, probeLanguage, type LanguageDef } from "./languages.js";

export interface RunLimits {
  compileTimeoutMs: number;
  runTimeoutMaxMs: number;
  outputCapBytes: number;
}

interface StepOptions {
  cwd: string;
  stdin?: string;
  timeoutMs: number;
  outputCap: number;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export function runStep(file: string, args: string[], opts: StepOptions): Promise<StepResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(file, args, {
      cwd: opts.cwd,
      windowsHide: true,
      detached: !isWindows,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });

    const cap = (buf: string, chunk: string): string => {
      if (buf.length >= opts.outputCap) {
        truncated = true;
        return buf;
      }
      const room = opts.outputCap - buf.length;
      if (chunk.length > room) truncated = true;
      return buf + chunk.slice(0, room);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout = cap(stdout, d);
      if (truncated) killTree(child.pid);
    });
    child.stderr.on("data", (d: string) => {
      stderr = cap(stderr, d);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);

    const finish = (exitCode: number | null, extraErr?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extraErr) stderr = cap(stderr, extraErr);
      resolve({
        ok: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        ms: Date.now() - started,
        timedOut,
        truncated,
      });
    };

    child.on("error", (e) => finish(null, `[runner] ${e.message}`));
    child.on("close", (code) => finish(code));

    child.stdin.on("error", () => {
      /* EPIPE when the program exits before reading stdin: ignore */
    });
    child.stdin.end(opts.stdin ?? "");
  });
}

type Vars = { src: string; out: string; dir: string };

function substitute(value: string, vars: Vars): string {
  return value.replace(/\{(src|out|dir)\}/g, (_, k: keyof Vars) => vars[k]);
}

export async function compileAndRun(req: CompileRequest, limits: RunLimits): Promise<CompileResponse> {
  const def: LanguageDef | undefined = findLanguage(req.language);
  if (!def) throw new Error(`unsupported language: ${req.language}`);
  if (!probeLanguage(def).available) throw new Error(`toolchain not installed for ${def.label}`);
  if (typeof req.code !== "string" || req.code.length === 0) throw new Error("code is required");
  if (req.code.length > 200_000) throw new Error("code too large (200KB max)");

  const runTimeout = Math.min(Math.max(Number(req.timeoutMs ?? 5000), 100), limits.runTimeoutMaxMs);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devhub-compile-"));
  const vars: Vars = { src: path.join(dir, def.fileName), out: path.join(dir, outputBinaryName()), dir };
  const response: CompileResponse = { language: def.id, compile: null, run: null };

  try {
    await fs.writeFile(vars.src, req.code, "utf8");
    if (def.compile) {
      response.compile = await runStep(
        def.compile.file,
        def.compile.args.map((a) => substitute(a, vars)),
        { cwd: dir, timeoutMs: limits.compileTimeoutMs, outputCap: limits.outputCapBytes },
      );
      if (!response.compile.ok) return response;
    }
    response.run = await runStep(
      substitute(def.run.file, vars),
      def.run.args.map((a) => substitute(a, vars)),
      { cwd: dir, stdin: req.stdin ?? "", timeoutMs: runTimeout, outputCap: limits.outputCapBytes },
    );
    return response;
  } finally {
    setTimeout(() => {
      fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }, 500);
  }
}

/** Baekjoon-style comparison: trailing whitespace per line and trailing newlines are ignored. */
export function judge(actual: string, expected: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .trim();
  return norm(actual) === norm(expected);
}

/** Global concurrency gate so a burst of runs cannot exhaust the machine. */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((r) => this.queue.push(r));
    }
    this.active++;
    return () => this.release();
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
