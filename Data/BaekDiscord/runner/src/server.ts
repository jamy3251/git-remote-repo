import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RunnerConfig } from "./config.js";
import type { ClientMessage, CompileRequest, CreateSessionRequest, Policy, ServerMessage, SupervisorEvent } from "./protocol.js";
import { SessionManager } from "./sessions.js";
import { presetInfos } from "./presets.js";
import { languageInfos } from "./compiler/languages.js";
import { compileAndRun, judge, Semaphore } from "./compiler/run.js";
import { createBrain } from "./supervisor/brain.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { ControlChat } from "./supervisor/chat.js";
import { TunnelManager } from "./tunnel.js";
import { proxyHttp, proxyUpgrade } from "./proxy.js";
import { gitSummary } from "./workspace.js";
import { AuthLockout, RateLimiter, clampString, clientKey, isSafeId, tokenMatches } from "./security.js";

export const RUNNER_VERSION = "0.2.0";
const API_PREFIX = "/runner";
const MAX_WS_MESSAGE = 256 * 1024;

interface ClientState {
  ws: WebSocket;
  authed: boolean;
  attached: Set<string>;
  client: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

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

function isPolicy(v: unknown): v is Policy {
  return v === "manual" || v === "assist" || v === "auto";
}

async function postDiscord(url: string, text: string): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 1900) }) });
  if (!res.ok && res.status !== 204) throw new Error(`webhook ${res.status}`);
}

export function createRunnerServer(cfg: RunnerConfig) {
  const allowedOrigins = new Set(cfg.allowedOrigins);
  const originAllowed = (origin: string | undefined): boolean => !origin || allowedOrigins.has(origin);

  const sessions = new SessionManager({
    cwdRoot: cfg.cwdRoot,
    maxSessions: cfg.maxSessions,
    historyBytes: cfg.historyBytes,
    defaultPolicy: cfg.supervisor.defaultPolicy,
  });
  const brain = createBrain({
    preference: cfg.supervisor.brain,
    model: cfg.supervisor.brainModel,
    apiKey: cfg.supervisor.apiKey,
    cliTimeoutMs: cfg.supervisor.cliTimeoutMs,
    onUsage: (input, output) => {
      supervisor.usage.inputTokens += input;
      supervisor.usage.outputTokens += output;
    },
  });
  const supervisor = new Supervisor(sessions, brain, {
    enabled: cfg.supervisor.enabled,
    defaultPolicy: cfg.supervisor.defaultPolicy,
    intervalMs: cfg.supervisor.intervalMs,
    notify: cfg.supervisor.notifyWebhook ? (text) => postDiscord(cfg.supervisor.notifyWebhook as string, text) : null,
  });
  const chat = new ControlChat(brain, sessions, supervisor, { cwdRoot: cfg.cwdRoot });
  const tunnel = new TunnelManager({ port: cfg.port, token: cfg.token, dashboardPath: cfg.dashboardPath });
  const compileGate = new Semaphore(2);
  const clients = new Set<ClientState>();
  const lockout = new AuthLockout();
  const httpLimiter = new RateLimiter(240, 60_000);
  const compileLimiter = new RateLimiter(20, 60_000);
  const runnerInfo = { version: RUNNER_VERSION, platform: process.platform, cwdRoot: cfg.cwdRoot };
  const webTarget = cfg.webProxy ? new URL(cfg.webProxy) : null;

  const send = (c: ClientState, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage, filter?: (c: ClientState) => boolean) => {
    for (const c of clients) if (c.authed && (!filter || filter(c))) send(c, msg);
  };

  sessions.on("output", (id: string, data: string) => broadcast({ type: "output", id, data }, (c) => c.attached.has(id)));
  sessions.on("exit", (id: string, exitCode: number | null, status) => broadcast({ type: "exit", id, exitCode, status }));
  sessions.on("updated", (session) => broadcast({ type: "updated", session }));
  sessions.on("removed", (id: string) => broadcast({ type: "removed", id }));
  supervisor.on("event", (event: SupervisorEvent) => broadcast({ type: "event", event }));
  supervisor.on("config", () => broadcast({ type: "supervisor", config: supervisor.config() }));
  tunnel.on("change", (status) => broadcast({ type: "tunnel", status }));
  tunnel.on("url", (url: string) => {
    allowedOrigins.add(url);
    supervisor.log("action", null, "system", `원격 터널 열림: ${url}`);
  });
  tunnel.on("warn", (m: string) => supervisor.log("warn", null, "system", m));
  supervisor.start();

  const authFailed = (client: string): { locked: boolean; remaining: number } => lockout.recordFailure(client);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const origin = req.headers.origin;
    const client = clientKey(req.socket.remoteAddress, req.headers["x-forwarded-for"]);
    const json = (status: number, body: unknown) => {
      const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS };
      if (origin && originAllowed(origin)) {
        headers["access-control-allow-origin"] = origin;
        headers["access-control-allow-headers"] = "authorization, content-type";
        headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
        headers["vary"] = "origin";
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    // Everything outside the runner namespace is the Next.js dashboard, reached through the proxy.
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (!webTarget) return json(404, { error: "not found", hint: `runner API lives under ${API_PREFIX}/` });
      return proxyHttp(req, res, webTarget);
    }
    const route = url.pathname.slice(API_PREFIX.length) || "/";

    if (req.method === "OPTIONS") return json(204, {});
    if (!originAllowed(origin)) return json(403, { error: "origin not allowed" });
    if (!httpLimiter.allow(client)) return json(429, { error: "too many requests" });

    if (route === "/health" && req.method === "GET") {
      return json(200, { ok: true, ...runnerInfo, sessions: sessions.list().length, tunnel: tunnel.status().state, supervisor: supervisor.config().enabled });
    }

    if (lockout.isLocked(client)) return json(429, { error: "too many failed logins; try again later", retryAfterMs: lockout.lockedFor(client) });
    if (!tokenMatches(bearer(req, url), cfg.token)) {
      const f = authFailed(client);
      if (f.locked) supervisor.log("warn", null, "system", `인증 실패 반복으로 ${client} 잠금`);
      return json(401, { error: "invalid token", remainingAttempts: f.remaining });
    }
    lockout.recordSuccess(client);

    try {
      if (route === "/languages" && req.method === "GET") return json(200, { languages: languageInfos() });
      if (route === "/presets" && req.method === "GET") return json(200, { presets: presetInfos() });
      if (route === "/sessions" && req.method === "GET") return json(200, { sessions: sessions.list() });
      if (route === "/events" && req.method === "GET") return json(200, { events: supervisor.recentEvents(Number(url.searchParams.get("limit")) || 200) });
      if (route === "/supervisor" && req.method === "GET") return json(200, { config: supervisor.config() });
      if (route === "/tunnel" && req.method === "GET") return json(200, { status: tunnel.status() });
      if (route === "/compile" && req.method === "POST") {
        if (!compileLimiter.allow(client)) return json(429, { error: "compile rate limit" });
        const body = (await readJson(req)) as CompileRequest & { expected?: string };
        const release = await compileGate.acquire();
        try {
          const result = await compileAndRun(body, cfg);
          const verdict = typeof body.expected === "string" && result.run ? judge(result.run.stdout, body.expected) : null;
          return json(200, { ...result, verdict });
        } finally {
          release();
        }
      }
      if (route === "/sessions" && req.method === "POST") {
        const body = (await readJson(req, 64_000)) as CreateSessionRequest;
        const session = sessions.create(body);
        supervisor.log("action", session.id, "human", `세션 생성(HTTP): ${session.name}`);
        broadcast({ type: "created", session });
        return json(201, { session });
      }
      const sessionRoute = route.match(/^\/sessions\/([A-Za-z0-9_-]{1,64})\/(input|kill|output|workspace)$/);
      if (sessionRoute) {
        const [, id, action] = sessionRoute;
        const s = sessions.get(id);
        if (!s) return json(404, { error: "no such session" });
        if (action === "output" && req.method === "GET") {
          const n = Math.max(1, Math.min(400, Number(url.searchParams.get("lines")) || 60));
          return json(200, { id, lines: sessions.tail(id, n) });
        }
        if (action === "workspace" && req.method === "GET") {
          return json(200, { info: { id, cwd: s.cwd, git: await gitSummary(s.cwd), activity: supervisor.activity(id) } });
        }
        if (action === "input" && req.method === "POST") {
          const body = (await readJson(req, 64_000)) as { data?: string };
          const data = clampString(body.data, 16_000);
          sessions.write(id, data);
          supervisor.log("action", id, "human", `입력(HTTP) ${data.length}자`);
          return json(200, { ok: true });
        }
        if (action === "kill" && req.method === "POST") {
          sessions.kill(id);
          supervisor.log("action", id, "human", "종료(HTTP)");
          return json(200, { ok: true });
        }
      }
      if (route === "/chat" && req.method === "POST") {
        const body = (await readJson(req, 64_000)) as { text?: string; confirm?: boolean };
        const text = clampString(body.text, 4000).trim();
        if (!text) return json(400, { error: "text required" });
        if (chat.busy) return json(409, { error: "chat busy" });
        const turn = await chat.send(text, body.confirm === true);
        return json(200, { turn, history: chat.history() });
      }
      return json(404, { error: "not found" });
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === `${API_PREFIX}/ws`) {
      if (!originAllowed(req.headers.origin)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    if (webTarget && !url.pathname.startsWith(API_PREFIX)) return proxyUpgrade(req, socket, head, webTarget);
    socket.destroy();
  });

  const greet = (state: ClientState) => {
    send(state, { type: "welcome", runner: runnerInfo });
    send(state, { type: "presets", presets: presetInfos() });
    send(state, { type: "sessions", sessions: sessions.list() });
    send(state, { type: "supervisor", config: supervisor.config() });
    send(state, { type: "tunnel", status: tunnel.status() });
    send(state, { type: "events", events: supervisor.recentEvents(100) });
  };

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const client = clientKey(req.socket.remoteAddress, req.headers["x-forwarded-for"]);
    if (lockout.isLocked(client)) return ws.close(4029, "locked out");
    const state: ClientState = { ws, authed: false, attached: new Set(), client };
    clients.add(state);
    const token = url.searchParams.get("token");
    if (token !== null) {
      state.authed = tokenMatches(token, cfg.token);
      if (!state.authed) {
        authFailed(client);
        send(state, { type: "error", message: "invalid token" });
        return ws.close(4001, "unauthorized");
      }
      lockout.recordSuccess(client);
      greet(state);
    }

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(state, { type: "error", message: "invalid JSON" });
      }
      if (msg.type === "hello") {
        state.authed = tokenMatches(msg.token, cfg.token);
        if (!state.authed) {
          const f = authFailed(client);
          send(state, { type: "error", message: f.locked ? "locked out" : "invalid token" });
          return ws.close(4001, "unauthorized");
        }
        lockout.recordSuccess(client);
        return greet(state);
      }
      if (!state.authed) return send(state, { type: "error", message: "not authenticated" });
      void handle(state, msg);
    });

    ws.on("close", () => clients.delete(state));
  });

  async function handle(state: ClientState, msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "list":
          return send(state, { type: "sessions", sessions: sessions.list() });
        case "presets":
          return send(state, { type: "presets", presets: presetInfos() });
        case "create": {
          const session = sessions.create(msg.req);
          state.attached.add(session.id);
          supervisor.log("action", session.id, "human", `세션 생성: ${session.name} (${session.preset}) @ ${session.cwd}`);
          broadcast({ type: "created", session, reqId: msg.reqId });
          return;
        }
        case "attach": {
          if (!isSafeId(msg.id) || !sessions.get(msg.id)) return send(state, { type: "error", message: `no session ${msg.id}` });
          state.attached.add(msg.id);
          return send(state, { type: "history", id: msg.id, data: sessions.history(msg.id) });
        }
        case "detach":
          if (isSafeId(msg.id)) state.attached.delete(msg.id);
          return;
        case "input": {
          const data = clampString(msg.data, 16_000);
          for (const id of msg.ids.filter(isSafeId)) sessions.write(id, data);
          return;
        }
        case "resize":
          if (isSafeId(msg.id)) sessions.resize(msg.id, Number(msg.cols), Number(msg.rows));
          return;
        case "kill":
          for (const id of msg.ids.filter(isSafeId)) {
            sessions.kill(id);
            supervisor.log("action", id, "human", "세션 종료");
          }
          return;
        case "remove":
          for (const id of msg.ids.filter(isSafeId)) sessions.remove(id);
          return;
        case "set_goal":
          if (isSafeId(msg.id)) supervisor.setGoal(msg.id, clampString(msg.goal, 500) || null, "human");
          return;
        case "set_policy":
          if (isSafeId(msg.id) && isPolicy(msg.policy)) supervisor.setPolicy(msg.id, msg.policy, "human");
          return;
        case "suggestion":
          if (isSafeId(msg.id) && isSafeId(msg.suggestionId) && (msg.decision === "approve" || msg.decision === "dismiss")) {
            supervisor.decide(msg.id, msg.suggestionId, msg.decision, "human");
          }
          return;
        case "events":
          return send(state, { type: "events", events: supervisor.recentEvents(msg.limit ?? 200) });
        case "supervisor":
          supervisor.setConfig({ enabled: msg.enabled, defaultPolicy: isPolicy(msg.defaultPolicy) ? msg.defaultPolicy : undefined }, "human");
          return;
        case "chat": {
          const text = clampString(msg.text, 4000).trim();
          if (!text) return send(state, { type: "error", message: "empty message" });
          if (chat.busy) return send(state, { type: "error", message: "관제 AI가 아직 이전 요청을 처리 중입니다" });
          broadcast({ type: "chat_status", busy: true });
          const history = chat.history();
          const userTurn = history[history.length - 1];
          void userTurn;
          const turn = await chat.send(text, msg.confirm === true);
          const all = chat.history();
          const mine = all[all.length - 2];
          if (mine) broadcast({ type: "chat", turn: mine });
          broadcast({ type: "chat", turn });
          broadcast({ type: "chat_status", busy: false });
          return;
        }
        case "chat_history":
          return send(state, { type: "chat_history", turns: chat.history(), busy: chat.busy });
        case "chat_reset":
          chat.reset();
          return broadcast({ type: "chat_history", turns: [], busy: false });
        case "tunnel": {
          if (msg.action === "start") {
            supervisor.log("action", null, "human", `원격 터널 시작 요청 (${msg.provider ?? "auto"})`);
            await tunnel.start(msg.provider);
          } else if (msg.action === "stop") {
            tunnel.stop();
            supervisor.log("action", null, "human", "원격 터널 종료");
          }
          return send(state, { type: "tunnel", status: tunnel.status() });
        }
        case "workspace": {
          if (!isSafeId(msg.id)) return;
          const s = sessions.get(msg.id);
          if (!s) return send(state, { type: "error", message: `no session ${msg.id}` });
          const git = await gitSummary(s.cwd);
          return send(state, { type: "workspace", info: { id: s.id, cwd: s.cwd, git, activity: supervisor.activity(s.id) } });
        }
        default:
          return send(state, { type: "error", message: "unknown message type" });
      }
    } catch (e) {
      const reqId = msg.type === "create" ? msg.reqId : undefined;
      send(state, { type: "error", message: (e as Error).message, reqId });
    }
  }

  return {
    server,
    sessions,
    supervisor,
    tunnel,
    brain,
    listen: () =>
      new Promise<number>((resolve) => {
        server.listen(cfg.port, cfg.host, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : cfg.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        supervisor.stop();
        tunnel.stop();
        sessions.killAll();
        for (const c of clients) c.ws.close();
        wss.close();
        server.close(() => resolve());
      }),
  };
}
