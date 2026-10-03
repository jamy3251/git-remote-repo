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
  /** Next.js origin proxied for every non-/runner path, or null to disable. */
  webProxy: string | null;
  /** Dashboard path opened by the tunnel QR code. */
  dashboardPath: string;
  supervisor: {
    enabled: boolean;
    defaultPolicy: "manual" | "assist" | "auto";
    intervalMs: number;
    brain: "auto" | "api" | "claude-cli" | "heuristic";
    brainModel: string | null;
    apiKey: string | null;
    cliTimeoutMs: number;
    /** Discord-compatible webhook that receives escalations (optional). */
    notifyWebhook: string | null;
  };
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
    allowedOrigins: (process.env.RUNNER_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:7331,http://127.0.0.1:7331")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webProxy: process.env.RUNNER_WEB_PROXY === "off" ? null : (process.env.RUNNER_WEB_PROXY ?? "http://127.0.0.1:3000"),
    dashboardPath: process.env.RUNNER_DASHBOARD_PATH ?? "/control",
    supervisor: {
      enabled: process.env.SUPERVISOR_ENABLED !== "0",
      defaultPolicy: asPolicy(process.env.SUPERVISOR_DEFAULT_POLICY) ?? "assist",
      intervalMs: Number(process.env.SUPERVISOR_INTERVAL_MS ?? 3000),
      brain: asBrain(process.env.SUPERVISOR_BRAIN) ?? "auto",
      brainModel: process.env.SUPERVISOR_MODEL?.trim() || null,
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
      cliTimeoutMs: Number(process.env.SUPERVISOR_CLI_TIMEOUT_MS ?? 120_000),
      notifyWebhook: process.env.SUPERVISOR_NOTIFY_WEBHOOK?.trim() || null,
    },
  };
}

function asPolicy(v: string | undefined): "manual" | "assist" | "auto" | null {
  return v === "manual" || v === "assist" || v === "auto" ? v : null;
}

function asBrain(v: string | undefined): "auto" | "api" | "claude-cli" | "heuristic" | null {
  return v === "auto" || v === "api" || v === "claude-cli" || v === "heuristic" ? v : null;
}

export const isWindows = os.platform() === "win32";
