import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createRunnerServer, tunnelWebAllowed } from "../src/server.js";
import type { RunnerConfig } from "../src/config.js";
import type { ServerMessage } from "../src/protocol.js";

// A stand-in for the Next dashboard: answers every path and remembers what it was asked for.
const webHits: string[] = [];
const web = http.createServer((req, res) => {
  webHits.push(req.url ?? "");
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`web:${req.url}`);
});

let runner: ReturnType<typeof createRunnerServer>;
let localPort = 0;
let tunnelPort = 0;

function cfgFor(webPort: number): RunnerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    tunnelPort: 0,
    tunnelIdleMs: 60 * 60_000,
    tunnelMaxMs: 0,
    token: "tunnel-test-token",
    cwdRoot: path.resolve(os.tmpdir()),
    maxSessions: 2,
    historyBytes: 64 * 1024,
    compileTimeoutMs: 20_000,
    runTimeoutMaxMs: 30_000,
    outputCapBytes: 64 * 1024,
    allowedOrigins: ["http://localhost:3000"],
    webProxy: `http://127.0.0.1:${webPort}`,
    dashboardPath: "/control",
    hooks: false,
    supervisor: { enabled: false, defaultPolicy: "assist", intervalMs: 100_000, brain: "heuristic", brainModel: null, apiKey: null, cliTimeoutMs: 1000, notifyWebhook: null },
  };
}

beforeAll(async () => {
  await new Promise<void>((r) => web.listen(0, "127.0.0.1", () => r()));
  const addr = web.address();
  runner = createRunnerServer(cfgFor(typeof addr === "object" && addr ? addr.port : 0));
  localPort = await runner.listen();
  tunnelPort = runner.tunnelPort();
});

afterAll(async () => {
  await runner.close();
  await new Promise<void>((r) => web.close(() => r()));
});

/** Raw request so the Host header can be set (fetch does not allow it). */
function rawGet(port: number, pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("tunnelWebAllowed", () => {
  it("allows only the control dashboard and its assets", () => {
    for (const p of ["/control", "/control/x", "/_next/static/chunks/a.js", "/manifest.webmanifest", "/sw.js", "/offline.html", "/icons/icon-192.png", "/favicon.ico"]) {
      expect(tunnelWebAllowed(p)).toBe(true);
    }
    for (const p of ["/", "/teams", "/api/auth/dev", "/api/cron/digest", "/join/abc", "/console", "/compile", "/products", "/controlx"]) {
      expect(tunnelWebAllowed(p)).toBe(false);
    }
  });
});

describe("tunnel listener", () => {
  it("binds a separate loopback port", () => {
    expect(tunnelPort).toBeGreaterThan(0);
    expect(tunnelPort).not.toBe(localPort);
  });

  it("proxies the control dashboard and its assets", async () => {
    const r = await rawGet(tunnelPort, "/control", { host: "abc.ngrok-free.app" });
    expect(r.status).toBe(200);
    expect(r.body).toBe("web:/control");
    expect((await rawGet(tunnelPort, "/_next/static/a.js", { host: "abc.ngrok-free.app" })).status).toBe(200);
  });

  it("does not reach the rest of the web app", async () => {
    const before = webHits.length;
    for (const p of ["/teams", "/api/auth/dev?login=x", "/console", "/"]) {
      const r = await rawGet(tunnelPort, p, { host: "abc.ngrok-free.app" });
      expect(r.status).toBe(404);
      expect(r.body).toContain("관제 화면만");
    }
    expect(webHits.length).toBe(before);
  });

  it("still serves the runner API", async () => {
    expect((await rawGet(tunnelPort, "/runner/health", { host: "abc.ngrok-free.app" })).status).toBe(200);
  });

  it("locks a tunnel client by the provider-written address, without locking the local user", async () => {
    // The first X-Forwarded-For entry changes every time (client-controlled); the last one (ngrok's) does not.
    for (let i = 0; i < 5; i++) {
      const r = await rawGet(tunnelPort, "/runner/sessions", { host: "abc.ngrok-free.app", authorization: "Bearer wrong", "x-forwarded-for": `10.0.0.${i}, 203.0.113.9` });
      expect(r.status).toBe(401);
    }
    const locked = await rawGet(tunnelPort, "/runner/sessions", { host: "abc.ngrok-free.app", authorization: "Bearer wrong", "x-forwarded-for": "10.9.9.9, 203.0.113.9" });
    expect(locked.status).toBe(429);
    const local = await rawGet(localPort, "/runner/sessions", { host: `127.0.0.1:${localPort}`, authorization: "Bearer tunnel-test-token" });
    expect(local.status).toBe(200);
  });

  it("refuses to open a tunnel from a remote connection", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${tunnelPort}/runner/ws`);
    const messages: ServerMessage[] = [];
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as ServerMessage));
    await new Promise<void>((r, j) => {
      ws.on("open", () => r());
      ws.on("error", j);
    });
    ws.send(JSON.stringify({ type: "hello", token: "tunnel-test-token" }));
    await waitFor(() => messages.some((m) => m.type === "welcome"));
    ws.send(JSON.stringify({ type: "tunnel", action: "start" }));
    await waitFor(() => messages.some((m) => m.type === "error"));
    const err = messages.find((m) => m.type === "error");
    expect(err && err.type === "error" && err.message).toContain("PC에서만");
    expect(runner.tunnel.status().state).toBe("stopped");
    ws.close();
  });
});

describe("remote sockets", () => {
  function open(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }
  const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on("close", (code) => r(code)));

  it("closes a socket that never says hello", async () => {
    const ws = await open(tunnelPort);
    const t0 = Date.now();
    expect(await closed(ws)).toBe(4008);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4_500);
  }, 10_000);

  it("tells remote devices the tunnel closed when the PC closes it", async () => {
    const remote = await open(tunnelPort);
    remote.send(JSON.stringify({ type: "hello", token: "tunnel-test-token" }));
    await new Promise<void>((r) => remote.once("message", () => r()));
    const local = new WebSocket(`ws://127.0.0.1:${localPort}/runner/ws?token=tunnel-test-token`);
    await new Promise<void>((r) => local.once("message", () => r()));
    const code = closed(remote);
    local.send(JSON.stringify({ type: "tunnel", action: "stop" }));
    expect(await code).toBe(4005);
    expect(local.readyState).toBe(WebSocket.OPEN);
    local.close();
  });
});

describe("local listener", () => {
  it("still proxies every dashboard page", async () => {
    const r = await rawGet(localPort, "/teams", { host: `127.0.0.1:${localPort}` });
    expect(r.status).toBe(200);
    expect(r.body).toBe("web:/teams");
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    expect((await rawGet(localPort, "/runner/health", { host: "evil.example" })).status).toBe(403);
    expect((await rawGet(localPort, "/control", { host: "evil.example" })).status).toBe(403);
  });
});

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
