import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RunnerConfig {
  host: string;
  port: number;
  token: string;
  /** Sessions may only start inside this directory tree. */
  cwdRoot: string;
  maxSessions: number;
  /** Ring buffer per session, bytes. */
  historyBytes: number;
  compileTimeoutMs: number;
  runTimeoutMaxMs: number;
  outputCapBytes: number;
  allowedOrigins: string[];
}

function loadToken(): string {
  if (process.env.RUNNER_TOKEN) return process.env.RUNNER_TOKEN;
  const file = path.join(process.cwd(), ".runner-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t) return t;
  } catch {
    /* generate below */
  }
  const t = randomBytes(18).toString("base64url");
  fs.writeFileSync(file, t, { encoding: "utf8" });
  return t;
}

export function loadConfig(): RunnerConfig {
  const port = Number(process.env.RUNNER_PORT ?? 7331);
  const cwdRoot = path.resolve(process.env.RUNNER_CWD_ROOT ?? path.resolve(process.cwd(), "..", "..", ".."));
  return {
    host: process.env.RUNNER_HOST ?? "127.0.0.1",
    port: Number.isFinite(port) ? port : 7331,
    token: loadToken(),
    cwdRoot,
    maxSessions: Number(process.env.RUNNER_MAX_SESSIONS ?? 12),
    historyBytes: 256 * 1024,
    compileTimeoutMs: 20_000,
    runTimeoutMaxMs: 30_000,
    outputCapBytes: 64 * 1024,
    allowedOrigins: (process.env.RUNNER_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const isWindows = os.platform() === "win32";
