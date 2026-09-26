import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RunnerConfig } from "./config.js";
import type { ClientMessage, CompileRequest, CreateSessionRequest, ServerMessage } from "./protocol.js";
import { SessionManager } from "./sessions.js";
import { presetInfos } from "./presets.js";
import { languageInfos } from "./compiler/languages.js";
import { compileAndRun, judge, Semaphore } from "./compiler/run.js";

export const RUNNER_VERSION = "0.1.0";

interface ClientState {
  ws: WebSocket;
  authed: boolean;
  attached: Set<string>;
}

function originAllowed(origin: string | undefined, cfg: RunnerConfig): boolean {
  if (!origin) return true; // non-browser clients (curl, tests)
  return cfg.allowedOrigins.includes(origin);
}

function readJson(req: http.IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      body += c;
      if (body.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function bearer(req: http.IncomingMessage, url: URL): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return url.searchParams.get("token");
}

export function createRunnerServer(cfg: RunnerConfig) {
  const sessions = new SessionManager({
    cwdRoot: cfg.cwdRoot,
    maxSessions: cfg.maxSessions,
    historyBytes: cfg.historyBytes,
  });
  const compileGate = new Semaphore(2);
  const clients = new Set<ClientState>();
  const runnerInfo = { version: RUNNER_VERSION, platform: process.platform, cwdRoot: cfg.cwdRoot };

  const send = (c: ClientState, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage, filter?: (c: ClientState) => boolean) => {
    for (const c of clients) if (c.authed && (!filter || filter(c))) send(c, msg);
  };

  sessions.on("output", (id: string, data: string) =>
    broadcast({ type: "output", id, data }, (c) => c.attached.has(id)),
  );
  sessions.on("exit", (id: string, exitCode: number | null, status) =>
    broadcast({ type: "exit", id, exitCode, status }),
  );
  sessions.on("updated", (session) => broadcast({ type: "updated", session }));
  sessions.on("removed", (id: string) => broadcast({ type: "removed", id }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const origin = req.headers.origin;
    const json = (status: number, body: unknown) => {
      const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
      if (origin && originAllowed(origin, cfg)) {
        headers["access-control-allow-origin"] = origin;
        headers["access-control-allow-headers"] = "authorization, content-type";
        headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") return json(204, {});
    if (!originAllowed(origin, cfg)) return json(403, { error: "origin not allowed" });

    if (url.pathname === "/health" && req.method === "GET") {
      return json(200, { ok: true, ...runnerInfo, sessions: sessions.list().length });
    }

    if (bearer(req, url) !== cfg.token) return json(401, { error: "invalid token" });

    try {
      if (url.pathname === "/languages" && req.method === "GET") return json(200, { languages: languageInfos() });
      if (url.pathname === "/presets" && req.method === "GET") return json(200, { presets: presetInfos() });
      if (url.pathname === "/sessions" && req.method === "GET") return json(200, { sessions: sessions.list() });
      if (url.pathname === "/compile" && req.method === "POST") {
        const body = (await readJson(req)) as CompileRequest & { expected?: string };
        const release = await compileGate.acquire();
        try {
          const result = await compileAndRun(body, cfg);
          const verdict =
            typeof body.expected === "string" && result.run ? judge(result.run.stdout, body.expected) : null;
          return json(200, { ...result, verdict });
        } finally {
          release();
        }
      }
      if (url.pathname === "/sessions" && req.method === "POST") {
        const body = (await readJson(req)) as CreateSessionRequest;
        return json(201, { session: sessions.create(body) });
      }
      return json(404, { error: "not found" });
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !originAllowed(req.headers.origin, cfg)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const greet = (state: ClientState) => {
    send(state, { type: "welcome", runner: runnerInfo });
    send(state, { type: "presets", presets: presetInfos() });
    send(state, { type: "sessions", sessions: sessions.list() });
  };

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const state: ClientState = { ws, authed: url.searchParams.get("token") === cfg.token, attached: new Set() };
    clients.add(state);
    if (state.authed) greet(state);

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(state, { type: "error", message: "invalid JSON" });
      }
      if (msg.type === "hello") {
        state.authed = msg.token === cfg.token;
        if (!state.authed) {
          send(state, { type: "error", message: "invalid token" });
          return ws.close(4001, "unauthorized");
        }
        return greet(state);
      }
      if (!state.authed) return send(state, { type: "error", message: "not authenticated" });

      try {
        switch (msg.type) {
          case "list":
            return send(state, { type: "sessions", sessions: sessions.list() });
          case "presets":
            return send(state, { type: "presets", presets: presetInfos() });
          case "create": {
            const session = sessions.create(msg.req);
            state.attached.add(session.id);
            broadcast({ type: "created", session, reqId: msg.reqId });
            return;
          }
          case "attach": {
            if (!sessions.get(msg.id)) return send(state, { type: "error", message: `no session ${msg.id}` });
            state.attached.add(msg.id);
            return send(state, { type: "history", id: msg.id, data: sessions.history(msg.id) });
          }
          case "detach":
            state.attached.delete(msg.id);
            return;
          case "input":
            for (const id of msg.ids) sessions.write(id, msg.data);
            return;
          case "resize":
            return sessions.resize(msg.id, msg.cols, msg.rows);
          case "kill":
            for (const id of msg.ids) sessions.kill(id);
            return;
          case "remove":
            for (const id of msg.ids) sessions.remove(id);
            return;
          default:
            return send(state, { type: "error", message: "unknown message type" });
        }
      } catch (e) {
        const reqId = msg.type === "create" ? msg.reqId : undefined;
        send(state, { type: "error", message: (e as Error).message, reqId });
      }
    });

    ws.on("close", () => clients.delete(state));
  });

  return {
    server,
    sessions,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(cfg.port, cfg.host, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : cfg.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        sessions.killAll();
        for (const c of clients) c.ws.close();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
