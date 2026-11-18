import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRunnerServer } from "../src/server.js";
import type { RunnerConfig } from "../src/config.js";

/** A stand-in for a Discord webhook: keeps every message it receives. */
const received: string[] = [];
const hook = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    received.push((JSON.parse(body) as { content: string }).content);
    res.writeHead(204).end();
  });
});

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-notify-"));
const work = path.join(scratch, "work");
fs.mkdirSync(work);

function config(webhook: string | null): RunnerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    tunnelPort: 0,
    tunnelIdleMs: 60 * 60_000,
    tunnelMaxMs: 0,
    token: "test-token",
    cwdRoot: scratch,
    maxSessions: 4,
    historyBytes: 64 * 1024,
    compileTimeoutMs: 20_000,
    runTimeoutMaxMs: 30_000,
    outputCapBytes: 64 * 1024,
    allowedOrigins: [],
    webProxy: null,
    dashboardPath: "/control",
    hooks: false,
    notify: { webhook, telegramToken: null, telegramChatId: null, kakaoRestKey: null, kakaoClientSecret: null, kakaoTokenFile: path.join(scratch, "kakao.json"), digestMin: 0, events: ["start", "wait", "done", "review", "digest"], linkUrl: null },
    supervisor: { enabled: false, defaultPolicy: "assist", intervalMs: 100_000, brain: "heuristic", brainModel: null, apiKey: null, cliTimeoutMs: 1000, notifyWebhook: null },
  };
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout; received so far: ${JSON.stringify(received)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("notifications from a running runner", () => {
  let runner: ReturnType<typeof createRunnerServer>;
  let silent: ReturnType<typeof createRunnerServer>;
  let port = 0;
  let silentPort = 0;
  const auth = { authorization: "Bearer test-token", "content-type": "application/json" };

  beforeAll(async () => {
    // The runner keeps its work log under <cwd>/.data: point it at a scratch folder, not the real one.
    vi.spyOn(process, "cwd").mockReturnValue(scratch);
    const hookPort = await new Promise<number>((resolve) => hook.listen(0, "127.0.0.1", () => resolve((hook.address() as { port: number }).port)));
    runner = createRunnerServer(config(`http://127.0.0.1:${hookPort}/hook`));
    port = await runner.listen();
    silent = createRunnerServer(config(null));
    silentPort = await silent.listen();
  });

  afterAll(async () => {
    await runner.close();
    await silent.close();
    await new Promise((r) => hook.close(r));
    vi.restoreAllMocks();
  });

  it("reports the configured channels", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/runner/notify`, { headers: auth });
    expect(await r.json()).toEqual({ channels: ["discord"], events: ["start", "wait", "done", "review", "digest"], digestMin: 0 });
  });

  it("sends a test message and returns the result per channel", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/runner/notify/test`, { method: "POST", headers: auth });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ results: [{ channel: "discord", ok: true }] });
    expect(received.some((t) => t.includes("알림 시험"))).toBe(true);
  });

  it("says nothing was sent when no session runs", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/runner/notify/digest`, { method: "POST", headers: auth });
    expect(await r.json()).toEqual({ results: [], sent: false });
  });

  it("refuses the test with a fixable message when no channel is set, and needs the token", async () => {
    const r = await fetch(`http://127.0.0.1:${silentPort}/runner/notify/test`, { method: "POST", headers: auth });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("NOTIFY_TELEGRAM_TOKEN");
    expect((await fetch(`http://127.0.0.1:${port}/runner/notify/test`, { method: "POST" })).status).toBe(401);
  });

  it("a session sends a start message, then a finish message with its result", async () => {
    received.length = 0;
    const r = await fetch(`http://127.0.0.1:${port}/runner/sessions`, { method: "POST", headers: auth, body: JSON.stringify({ preset: "custom", command: "echo notify-check", cwd: work, name: "알림 확인", goal: "시작과 끝" }) });
    expect(r.status).toBe(201);
    await until(() => received.some((t) => t.startsWith("[DevHub] 시작: 알림 확인")));
    expect(received.find((t) => t.startsWith("[DevHub] 시작"))).toBe("[DevHub] 시작: 알림 확인 (custom)\n폴더: work\n목표: 시작과 끝");
    await until(() => received.some((t) => t.startsWith("[DevHub] 완료: 알림 확인")));
    expect(received.find((t) => t.startsWith("[DevHub] 완료"))).toContain("파일 변경 없음");
  });
});
