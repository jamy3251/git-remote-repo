import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createRunnerServer } from "../src/server.js";
import type { RunnerConfig } from "../src/config.js";
import type { ServerMessage } from "../src/protocol.js";

const cfg: RunnerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "test-token",
  cwdRoot: path.resolve(os.tmpdir()),
  maxSessions: 4,
  historyBytes: 64 * 1024,
  compileTimeoutMs: 20_000,
  runTimeoutMaxMs: 30_000,
  outputCapBytes: 64 * 1024,
  allowedOrigins: ["http://localhost:3000"],
  webProxy: null,
  dashboardPath: "/control",
  supervisor: {
    enabled: false,
    defaultPolicy: "assist",
    intervalMs: 100_000,
    brain: "heuristic",
    brainModel: null,
    apiKey: null,
    cliTimeoutMs: 1000,
    notifyWebhook: null,
  },
};

let runner: ReturnType<typeof createRunnerServer>;
let port = 0;
const base = () => `http://127.0.0.1:${port}`;

beforeAll(async () => {
  runner = createRunnerServer(cfg);
  port = await runner.listen();
});

afterAll(async () => {
  await runner.close();
});

function connect(token = cfg.token): Promise<{ ws: WebSocket; next: (pred: (m: ServerMessage) => boolean, ms?: number) => Promise<ServerMessage>; send: (m: unknown) => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws?token=${token}`);
    const queue: ServerMessage[] = [];
    const waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      const i = waiters.findIndex((w) => w.pred(m));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
      else queue.push(m);
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        send: (m) => ws.send(JSON.stringify(m)),
        next: (pred, ms = 10_000) =>
          new Promise((res, rej) => {
            const qi = queue.findIndex(pred);
            if (qi >= 0) return res(queue.splice(qi, 1)[0]);
            const t = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
            waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
          }),
      }),
    );
  });
}

describe("http", () => {
  it("serves /health without a token", async () => {
    const r = await fetch(`${base()}/runner/health`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; cwdRoot: string };
    expect(j.ok).toBe(true);
    expect(j.cwdRoot).toBe(cfg.cwdRoot);
  });

  it("rejects protected routes without a token", async () => {
    expect((await fetch(`${base()}/runner/languages`)).status).toBe(401);
    expect((await fetch(`${base()}/runner/languages?token=nope`)).status).toBe(401);
  });

  it("rejects disallowed browser origins", async () => {
    const r = await fetch(`${base()}/runner/health`, { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("lists languages and presets with a bearer token", async () => {
    const h = { authorization: `Bearer ${cfg.token}` };
    const langs = (await (await fetch(`${base()}/runner/languages`, { headers: h })).json()) as { languages: unknown[] };
    expect(langs.languages.length).toBeGreaterThan(3);
    const presets = (await (await fetch(`${base()}/runner/presets`, { headers: h })).json()) as { presets: { id: string }[] };
    expect(presets.presets.map((p) => p.id)).toContain("claude");
  });

  it("compiles via POST /compile with an expected-output verdict", async () => {
    const r = await fetch(`${base()}/runner/compile?token=${cfg.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "javascript", code: "console.log(6*7)", expected: "42" }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { run: { stdout: string }; verdict: boolean };
    expect(j.run.stdout.trim()).toBe("42");
    expect(j.verdict).toBe(true);
  });
});

describe("websocket sessions", () => {
  it("refuses an unauthenticated client", async () => {
    const c = await connect("wrong");
    c.send({ type: "list" });
    const m = await c.next((m) => m.type === "error");
    expect(m.type).toBe("error");
    c.ws.close();
  });

  it("creates a pty session, streams output, and reports exit", async () => {
    const c = await connect();
    await c.next((m) => m.type === "welcome");
    c.send({
      type: "create",
      reqId: "r1",
      req: { preset: "custom", command: process.platform === "win32" ? "echo hello-devhub" : "echo hello-devhub", cwd: cfg.cwdRoot, name: "echo" },
    });
    const created = await c.next((m) => m.type === "created");
    expect(created.type === "created" && created.session.name).toBe("echo");
    const id = created.type === "created" ? created.session.id : "";
    let collected = "";
    for (;;) {
      const m = await c.next((m) => (m.type === "output" && m.id === id) || (m.type === "exit" && m.id === id));
      if (m.type === "output") collected += m.data;
      if (m.type === "exit") break;
    }
    expect(collected).toContain("hello-devhub");
    expect(runner.sessions.get(id)?.status).toBe("exited");

    // history is available to late attachers
    const c2 = await connect();
    await c2.next((m) => m.type === "welcome");
    c2.send({ type: "attach", id });
    const h = await c2.next((m) => m.type === "history");
    expect(h.type === "history" && h.data).toContain("hello-devhub");
    c2.ws.close();
    c.ws.close();
  });

  it("broadcasts input to several sessions and kills them", async () => {
    const c = await connect();
    await c.next((m) => m.type === "welcome");
    const cmd = process.platform === "win32" ? "cmd.exe /q /k" : "cat";
    c.send({ type: "create", reqId: "a", req: { preset: "custom", command: cmd, cwd: cfg.cwdRoot } });
    c.send({ type: "create", reqId: "b", req: { preset: "custom", command: cmd, cwd: cfg.cwdRoot } });
    const a = await c.next((m) => m.type === "created" && m.reqId === "a");
    const b = await c.next((m) => m.type === "created" && m.reqId === "b");
    const ids = [a, b].map((m) => (m.type === "created" ? m.session.id : ""));
    c.send({ type: "input", ids, data: "echo multi-control\r" });
    const seen = new Set<string>();
    while (seen.size < 2) {
      const m = await c.next((m) => m.type === "output" && ids.includes(m.id) && m.data.includes("multi-control"));
      if (m.type === "output") seen.add(m.id);
    }
    c.send({ type: "kill", ids });
    for (const id of ids) {
      await c.next((m) => m.type === "exit" && m.id === id);
      expect(runner.sessions.get(id)?.status).toBe("killed");
    }
    c.send({ type: "remove", ids });
    await c.next((m) => m.type === "removed");
    c.ws.close();
  });

  it("rejects a cwd outside the root", async () => {
    const c = await connect();
    await c.next((m) => m.type === "welcome");
    c.send({ type: "create", reqId: "x", req: { preset: "custom", command: "echo hi", cwd: path.resolve(cfg.cwdRoot, "..", "..", "..") } });
    const e = await c.next((m) => m.type === "error");
    expect(e.type === "error" && e.message).toMatch(/cwd/);
    c.ws.close();
  });
});
