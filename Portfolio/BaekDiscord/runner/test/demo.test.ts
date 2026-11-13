import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage, SessionInfo } from "../src/protocol.js";
import { createDemoServer } from "../src/demo/server.js";

type Demo = ReturnType<typeof createDemoServer>;
let demo: Demo | null = null;

afterEach(async () => {
  await demo?.close();
  demo = null;
});

async function start(): Promise<number> {
  demo = createDemoServer({ webProxy: null, tickMs: 0, now: () => 1_800_000_000_000 });
  return demo.listen(0);
}

function connect(port: number): Promise<{ ws: WebSocket; next: (type: ServerMessage["type"]) => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/runner/ws?token=anything`);
    const inbox: ServerMessage[] = [];
    const waiters: Array<{ type: string; resolve: (m: ServerMessage) => void }> = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    const next = (type: ServerMessage["type"]) =>
      new Promise<ServerMessage>((res) => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return res(inbox.splice(i, 1)[0]);
        waiters.push({ type, resolve: res });
      });
    ws.on("open", () => resolve({ ws, next }));
    ws.on("error", reject);
  });
}

describe("demo runner", () => {
  it("greets any token with demo sessions in four states", async () => {
    const port = await start();
    const { ws, next } = await connect(port);
    const welcome = (await next("welcome")) as Extract<ServerMessage, { type: "welcome" }>;
    expect(welcome.runner.demo).toBe(true);
    const { sessions } = (await next("sessions")) as { sessions: SessionInfo[] };
    expect(sessions.map((s) => s.state)).toEqual(["working", "waiting_input", "error", "done"]);
    const tunnel = (await next("tunnel")) as Extract<ServerMessage, { type: "tunnel" }>;
    expect(tunnel.status.state).toBe("running");
    ws.close();
  });

  it("approving the suggestion moves the waiting session on", async () => {
    const port = await start();
    const { ws, next } = await connect(port);
    const { sessions } = (await next("sessions")) as { sessions: SessionInfo[] };
    const waiting = sessions.find((s) => s.state === "waiting_input")!;
    ws.send(JSON.stringify({ type: "suggestion", id: waiting.id, suggestionId: waiting.suggestion!.id, decision: "approve" }));
    const updated = (await next("updated")) as { session: SessionInfo };
    expect(updated.session.state).toBe("working");
    expect(updated.session.suggestion).toBeNull();
    ws.close();
  });

  it("refuses to open a tunnel and answers health", async () => {
    const port = await start();
    const { ws, next } = await connect(port);
    ws.send(JSON.stringify({ type: "tunnel", action: "start", provider: "ngrok" }));
    const err = (await next("error")) as { message: string };
    expect(err.message).toMatch(/데모/);
    ws.close();
    const health = await fetch(`http://127.0.0.1:${port}/runner/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, demo: true });
  });

  it("does not load node-pty or anything that spawns processes", () => {
    // Walk the demo's relative imports and make sure the session manager is never reached.
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      expect(src).not.toMatch(/from "node-pty"|from "node:child_process"/);
      for (const m of src.matchAll(/^import [^;]*? from "(\.[^"]+)\.js";/gm)) walk(path.resolve(path.dirname(file), `${m[1]}.ts`));
    };
    walk(path.resolve(__dirname, "../src/demo/index.ts"));
    expect([...seen].some((f) => f.endsWith("sessions.ts"))).toBe(false);
  });
});
