import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { RunnerConfig } from "./config.js";
import type { ClientMessage, CompileRequest, CreateSessionRequest, CrossReview, GitFileChange, Policy, ReviewMode, ReviewerId, ServerMessage, SupervisorEvent, WorkLogEntry } from "./protocol.js";
import { SessionManager } from "./sessions.js";
import { presetInfos } from "./presets.js";
import { languageInfos } from "./compiler/languages.js";
import { compileAndRun, judge, Semaphore } from "./compiler/run.js";
import { createBrain } from "./supervisor/brain.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { ControlChat } from "./supervisor/chat.js";
import { TunnelManager } from "./tunnel.js";
import { listFolder, type FolderContext } from "./fsbrowse.js";
import { claudeActivity } from "./cliactivity.js";
import { WorkLog, gitDelta } from "./worklog.js";
import { buildReviewPrompt, collectDiff, fixPrompt, parseReview, pickReviewer } from "./crossreview.js";
import { binaryAvailable } from "./presets.js";
import { ProductStore } from "./products.js";
import { PlaybookStore } from "./playbook.js";
import { heuristicSummary, refinePrompt, summarizeWork } from "./prompts.js";
import { proxyHttp, proxyUpgrade } from "./proxy.js";
import { gitChangesSync, gitSummary } from "./workspace.js";
import { AuthLockout, RateLimiter, clampString, clientKey, hostAllowed, isSafeId, redactSecrets, tokenMatches, type Listener } from "./security.js";
import { closesAt as tunnelClosesAt, freshIdleState, tickIdle, type IdleState } from "./tunnelidle.js";

export const RUNNER_VERSION = "0.2.0";
const API_PREFIX = "/runner";
const MAX_WS_MESSAGE = 256 * 1024;
/** Server-side ping cadence; a socket that misses one full interval is terminated. */
export const HEARTBEAT_MS = 20_000;
/** An unauthenticated socket must send `hello` (or have connected with a token) within this time. */
export const HELLO_TIMEOUT_MS = 5_000;
const MAX_PREAUTH_SOCKETS = 20;
const MAX_PREAUTH_MESSAGE = 1024;
/** WebSocket close code sent to remote devices when the tunnel closes. */
export const CLOSE_TUNNEL_CLOSED = 4005;

/**
 * Dashboard paths reachable through the tunnel listener. Everything else the Next app serves
 * (team digest pages, /api/*, /console, /compile, dev login) stays local-only.
 */
export function tunnelWebAllowed(pathname: string): boolean {
  if (pathname === "/control" || pathname.startsWith("/control/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/icons/")) return true;
  return pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname === "/offline.html" || pathname === "/favicon.ico";
}

const TUNNEL_BLOCKED_PAGE =
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DevHub</title>` +
  `<body style="font-family:system-ui;background:#0b0d10;color:#e6e8eb;padding:2rem">` +
  `<h2>원격 접속으로는 관제 화면만 열립니다</h2><p><a href="/control" style="color:#7c9cff">관제 화면으로 이동</a></p></body>`;

interface ClientState {
  ws: WebSocket;
  authed: boolean;
  attached: Set<string>;
  client: string;
  listener: Listener;
  /** Answered the last server ping. */
  alive: boolean;
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

  /** Uncommitted changes in each session's folder right before it spawned, so the log shows only its own. */
  const gitBaseline = new Map<string, GitFileChange[] | null>();
  const sessions = new SessionManager({
    cwdRoot: cfg.cwdRoot,
    maxSessions: cfg.maxSessions,
    historyBytes: cfg.historyBytes,
    defaultPolicy: cfg.supervisor.defaultPolicy,
    beforeSpawn: (info) => {
      if (!info.tags.includes("review")) gitBaseline.set(info.id, gitChangesSync(info.cwd));
    },
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
  const chat = new ControlChat(brain, sessions, supervisor, {
    cwdRoot: cfg.cwdRoot,
    worklog: (limit) => worklog.list(limit),
    crossReview: (id, reviewer, mode) => startReview(id, reviewer, mode, "chat"),
    products: async () => (await products.list()).products,
    playbook: (q) => playbook.search(q, 5),
    liveFolders: () => listFolder(cfg.cwdRoot, null, folderContext()).live,
  });
  let boundTunnelPort = 0;
  const tunnel = new TunnelManager({ port: () => boundTunnelPort, token: cfg.token, dashboardPath: cfg.dashboardPath });
  const compileGate = new Semaphore(2);
  const clients = new Set<ClientState>();
  const lockout = new AuthLockout();
  const httpLimiter = new RateLimiter(240, 60_000);
  const compileLimiter = new RateLimiter(20, 60_000);
  // Prompt-model calls (refine, summarize) cost tokens; keep a phone tapping a button from burning them.
  const aiLimiter = new RateLimiter(12, 60_000);
  const folderContext = (): FolderContext => ({
    running: sessions
      .list()
      .filter((s) => s.status === "running")
      .map((s) => s.cwd),
    claude: claudeActivity(),
  });
  const worklog = new WorkLog(path.join(process.cwd(), ".data", "worklog.jsonl"));
  const summarizing = new Set<string>();
  const playbook = new PlaybookStore(process.env.RUNNER_PLAYBOOK_DIR ?? path.resolve(process.cwd(), "..", "docs", "playbook"), brain);
  const products = new ProductStore(cfg.cwdRoot, path.join(process.cwd(), ".data", "products.json"), { worklog: () => worklog.list(500), brain });

  /** Have a different AI review a finished session, read-only. Returns the updated log entry. */
  async function startReview(entryId: string, requested?: ReviewerId | "auto", mode: ReviewMode = "review", actor: "human" | "chat" | "system" = "human"): Promise<WorkLogEntry> {
    const entry = worklog.get(entryId);
    if (!entry) throw new Error(`작업 내역 ${entryId} 없음`);
    if (entry.reviews?.some((r) => r.status === "running")) throw new Error("이미 교차검증 중입니다");
    const reviewer = pickReviewer(entry.preset, requested, { codex: binaryAvailable("codex"), claude: binaryAvailable("claude") });
    if (!reviewer) throw new Error("검토할 AI CLI(codex 또는 claude)가 설치되어 있지 않습니다");
    const git = await gitSummary(entry.cwd, 0).catch(() => null);
    const diff = git && entry.git?.files.length ? await collectDiff(git.repoRoot, entry.git.files) : "";
    const session = sessions.create({
      preset: `${reviewer}-review`,
      cwd: entry.cwd,
      prompt: buildReviewPrompt(entry, diff, mode, reviewer),
      name: `검증 · ${entry.name}`.slice(0, 60),
      goal: `${entry.name} 교차검증`,
      policy: "manual",
      tags: ["review", `review-of:${entryId}`],
    });
    broadcast({ type: "created", session });
    const review: CrossReview = { sessionId: session.id, reviewer, mode, status: "running", verdict: null, summary: "", findings: [], startedAt: Date.now(), endedAt: null };
    const next = worklog.update(entryId, { reviews: [...(entry.reviews ?? []), review] })!;
    broadcast({ type: "worklog_entry", entry: next });
    supervisor.log("action", session.id, actor, `교차검증 시작: ${entry.name} → ${reviewer === "codex" ? "Codex" : "Claude"} (${mode === "challenge" ? "도전" : "리뷰"})`);
    return next;
  }

  /** A reviewer session ended: parse its verdict onto the reviewed entry instead of logging it as work. */
  function finishReview(reviewSessionId: string, targetId: string): void {
    const entry = worklog.get(targetId);
    const s = sessions.get(reviewSessionId);
    if (!entry || !s) return;
    const parsed = parseReview(sessions.history(reviewSessionId));
    const reviews = (entry.reviews ?? []).map((r) =>
      r.sessionId !== reviewSessionId
        ? r
        : parsed
          ? { ...r, ...parsed, summary: redactSecrets(parsed.summary), status: "done" as const, endedAt: Date.now() }
          : { ...r, status: "failed" as const, summary: `검토 결과를 읽지 못했습니다 (${s.status}${s.exitCode !== null ? ` code ${s.exitCode}` : ""}). 세션 출력을 확인하세요.`, endedAt: Date.now() },
    );
    const r = reviews.find((x) => x.sessionId === reviewSessionId)!;
    if (r.verdict === "fail" && r.findings.length) r.fixPrompt = fixPrompt(entry, r);
    const next = worklog.update(targetId, { reviews })!;
    broadcast({ type: "worklog_entry", entry: next });
    const p1 = r.findings.filter((f) => f.severity === "P1").length;
    const verdict = r.status === "failed" ? "실패" : r.verdict === "pass" ? "통과" : r.verdict === "fail" ? `수정 필요 (P1 ${p1}건, 전체 ${r.findings.length}건)` : "판단 보류";
    supervisor.log(r.verdict === "fail" ? "warn" : "info", reviewSessionId, "system", `교차검증 ${verdict}: ${entry.name}`);
  }

  async function recordWork(id: string): Promise<void> {
    const s = sessions.get(id);
    if (!s || worklog.get(id)) return;
    const reviewOf = s.tags.find((t) => t.startsWith("review-of:"));
    if (reviewOf) return finishReview(id, reviewOf.slice("review-of:".length));
    const git = await gitSummary(s.cwd, 0).catch(() => null);
    const after = gitChangesSync(s.cwd);
    const before = gitBaseline.get(id) ?? null;
    gitBaseline.delete(id);
    const entry: WorkLogEntry = {
      id,
      name: s.name,
      preset: s.preset,
      cwd: s.cwd,
      goal: s.goal,
      prompt: sessions.promptOf(id)?.slice(0, 4000) ?? null,
      startedAt: s.createdAt,
      endedAt: s.endedAt ?? Date.now(),
      status: s.status,
      exitCode: s.exitCode,
      bytes: s.bytes,
      tail: sessions.tail(id, 80).map((l) => redactSecrets(l).slice(0, 400)),
      git: git ? gitDelta(before, { ...git, changed: after ?? git.changed }) : null,
      summary: "",
      summarySource: "heuristic",
    };
    entry.summary = heuristicSummary(entry);
    worklog.add(entry);
    broadcast({ type: "worklog_entry", entry });
    const auto = sessions.crossReviewOf(id);
    if (auto && s.status === "exited") {
      startReview(id, auto, "review", "system").catch((e) => supervisor.log("error", id, "system", `자동 교차검증 실패: ${(e as Error).message}`));
    }
  }

  /** Ask the prompt model for a short result summary of one finished session (on demand: costs tokens). */
  async function summarizeEntry(id: string): Promise<WorkLogEntry> {
    const e = worklog.get(id);
    if (!e) throw new Error(`작업 내역 ${id} 없음`);
    if (summarizing.has(id)) throw new Error("이미 요약 중입니다");
    summarizing.add(id);
    try {
      const text = await summarizeWork(brain, e);
      if (!text) throw new Error("요약할 모델이 없습니다 (판단 엔진: heuristic)");
      const next = worklog.update(id, { summary: redactSecrets(text), summarySource: "brain" })!;
      broadcast({ type: "worklog_entry", entry: next });
      supervisor.log("info", id, "system", `작업 요약: ${next.summary.slice(0, 120)}`);
      return next;
    } finally {
      summarizing.delete(id);
    }
  }

  async function refine(text: string, cwdInput?: string) {
    const listing = listFolder(cfg.cwdRoot, cwdInput ?? null);
    const git = await gitSummary(listing.path).catch(() => null);
    return refinePrompt(brain, clampString(text, 4000), { cwd: listing.path, markers: listing.markers, branch: git?.branch ?? null });
  }
  const runnerInfo = { version: RUNNER_VERSION, platform: process.platform, cwdRoot: cfg.cwdRoot };
  const webTarget = cfg.webProxy ? new URL(cfg.webProxy) : null;

  const send = (c: ClientState, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage, filter?: (c: ClientState) => boolean) => {
    for (const c of clients) if (c.authed && (!filter || filter(c))) send(c, msg);
  };

  sessions.on("output", (id: string, data: string) => broadcast({ type: "output", id, data }, (c) => c.attached.has(id)));
  sessions.on("exit", (id: string, exitCode: number | null, status) => {
    broadcast({ type: "exit", id, exitCode, status });
    // Record the finished session once its last output and the git state have settled.
    setTimeout(() => void recordWork(id), 1500);
  });
  sessions.on("updated", (session) => broadcast({ type: "updated", session }));
  sessions.on("removed", (id: string) => broadcast({ type: "removed", id }));
  supervisor.on("event", (event: SupervisorEvent) => broadcast({ type: "event", event }));
  supervisor.on("config", () => broadcast({ type: "supervisor", config: supervisor.config() }));
  tunnel.on("change", (status) => broadcast({ type: "tunnel", status }));
  tunnel.on("url", (url: string) => {
    allowedOrigins.add(url);
    idle = freshIdleState(Date.now());
    refreshTunnel();
    supervisor.log("action", null, "system", `원격 터널 열림: ${url}`);
  });

  // ---- remote presence and forgotten-tunnel auto-close -------------------------------------
  let idle: IdleState | null = null;
  const remoteClients = () => [...clients].filter((c) => c.authed && c.listener === "tunnel" && c.alive).length;
  const idleInput = () => ({ startedAt: tunnel.status().startedAt ?? Date.now(), idleMs: cfg.tunnelIdleMs, maxMs: cfg.tunnelMaxMs });

  /** Push the live device count and close time to dashboards (no-op when unchanged). */
  function refreshTunnel(): void {
    if (tunnel.status().state !== "running" || !idle) return tunnel.annotate({ remoteClients: 0, closesAt: null });
    const n = remoteClients();
    if (n > 0) idle.lastRemoteAt = Date.now();
    tunnel.annotate({ remoteClients: n, closesAt: n > 0 ? null : tunnelClosesAt(idle, idleInput()) });
  }

  /** Close every remote socket with the tunnel-closed code, then stop the tunnel process. */
  function closeTunnel(reason: string, actor: SupervisorEvent["actor"]): void {
    for (const c of clients) if (c.listener === "tunnel") c.ws.close(CLOSE_TUNNEL_CLOSED, "tunnel closed");
    tunnel.stop();
    idle = null;
    supervisor.log("action", null, actor, reason);
  }

  function tickTunnel(now = Date.now()): void {
    if (tunnel.status().state !== "running" || !idle) return;
    const running = sessions.list().filter((s) => s.status === "running").length;
    const action = tickIdle(idle, { ...idleInput(), now, remoteClients: remoteClients(), runningSessions: running });
    const at = (t: number) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    if (action.kind === "warn") supervisor.log("warn", null, "system", `연결된 원격 기기가 없어 ${at(action.closesAt)}에 원격 터널이 자동으로 닫힙니다`);
    if (action.kind === "extend") supervisor.log("info", null, "system", `실행 중인 세션이 있어 원격 터널 자동 닫힘을 ${at(action.closesAt)}로 미룹니다`);
    if (action.kind === "close") {
      const hours = Math.round(cfg.tunnelMaxMs / 3_600_000);
      const mins = Math.round(cfg.tunnelIdleMs / 60_000);
      return closeTunnel(action.reason === "max" ? `원격 터널 자동 닫힘: 연 지 ${hours}시간이 지남` : `원격 터널 자동 닫힘: ${mins}분 동안 연결된 원격 기기 없음`, "system");
    }
    refreshTunnel();
  }

  // Ping every socket; terminate the ones that did not answer the previous ping (half-open phone sockets).
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        c.ws.terminate();
      }
    }
    tickTunnel();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  tunnel.on("warn", (m: string) => supervisor.log("warn", null, "system", m));
  supervisor.start();

  const authFailed = (client: string): { locked: boolean; remaining: number } => lockout.recordFailure(client);

  const keyFor = (req: http.IncomingMessage, listener: Listener) =>
    clientKey(req.socket.remoteAddress, req.headers, listener, listener === "tunnel" ? tunnel.provider() : null);

  const handleHttp = (listener: Listener) => async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin;
    const client = keyFor(req, listener);
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

    // The local listener only answers to local host names, so a web page that rebinds its own
    // domain to 127.0.0.1 cannot reach the runner or the proxied dashboard.
    if (listener === "local" && !hostAllowed(req.headers.host, allowedOrigins)) return json(403, { error: "host not allowed" });

    // Everything outside the runner namespace is the Next.js dashboard, reached through the proxy.
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (listener === "tunnel" && !tunnelWebAllowed(url.pathname)) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
        return res.end(TUNNEL_BLOCKED_PAGE);
      }
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
      if (route === "/products" && req.method === "GET") return json(200, await products.list(url.searchParams.get("refresh") === "1"));
      if (route === "/worklog" && req.method === "GET") return json(200, { entries: worklog.list(Number(url.searchParams.get("limit")) || 50) });
      if (route === "/refine" && req.method === "POST") {
        const body = (await readJson(req, 64_000)) as { text?: string; cwd?: string };
        if (!body.text?.trim()) return json(400, { error: "text required" });
        if (!aiLimiter.allow(client)) return json(429, { error: "refine rate limit" });
        return json(200, { result: await refine(body.text, body.cwd) });
      }
      if (route === "/fs" && req.method === "GET") return json(200, { listing: listFolder(cfg.cwdRoot, url.searchParams.get("path"), folderContext()) });
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
  };

  const server = http.createServer(handleHttp("local"));
  const tunnelServer = http.createServer(handleHttp("tunnel"));

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE });
  const handleUpgrade = (listener: Listener) => (req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    // A client that drops mid-handshake (flaky phone network, killed tab) must not crash the runner.
    socket.on("error", () => socket.destroy());
    const url = new URL(req.url ?? "/", "http://localhost");
    if (listener === "local" && !hostAllowed(req.headers.host, allowedOrigins)) {
      socket.destroy();
      return;
    }
    if (url.pathname === `${API_PREFIX}/ws`) {
      if (!originAllowed(req.headers.origin)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, listener));
      return;
    }
    const webAllowed = listener === "local" || tunnelWebAllowed(url.pathname);
    if (webTarget && webAllowed && !url.pathname.startsWith(API_PREFIX)) return proxyUpgrade(req, socket, head, webTarget);
    socket.destroy();
  };
  server.on("upgrade", handleUpgrade("local"));
  tunnelServer.on("upgrade", handleUpgrade("tunnel"));

  const greet = (state: ClientState) => {
    send(state, { type: "welcome", runner: runnerInfo });
    send(state, { type: "presets", presets: presetInfos() });
    send(state, { type: "sessions", sessions: sessions.list() });
    send(state, { type: "supervisor", config: supervisor.config() });
    send(state, { type: "tunnel", status: tunnel.status() });
    send(state, { type: "events", events: supervisor.recentEvents(100) });
  };

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage, listener: Listener = "local") => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const client = keyFor(req, listener);
    if (lockout.isLocked(client)) return ws.close(4029, "locked out");
    if ([...clients].filter((c) => !c.authed).length >= MAX_PREAUTH_SOCKETS) return ws.close(1013, "too many pending connections");
    const state: ClientState = { ws, authed: false, attached: new Set(), client, listener, alive: true };
    clients.add(state);
    ws.on("pong", () => {
      state.alive = true;
    });
    const helloTimer = setTimeout(() => {
      if (!state.authed) ws.close(4008, "hello timeout");
    }, HELLO_TIMEOUT_MS);
    helloTimer.unref?.();
    const onAuthed = () => {
      clearTimeout(helloTimer);
      lockout.recordSuccess(client);
      greet(state);
      if (listener === "tunnel") refreshTunnel();
    };
    const token = url.searchParams.get("token");
    if (token !== null) {
      state.authed = tokenMatches(token, cfg.token);
      if (!state.authed) {
        authFailed(client);
        send(state, { type: "error", message: "invalid token" });
        return ws.close(4001, "unauthorized");
      }
      onAuthed();
    }

    ws.on("message", (raw: Buffer) => {
      if (!state.authed && raw.length > MAX_PREAUTH_MESSAGE) return ws.close(1009, "message too large before authentication");
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
        return onAuthed();
      }
      if (!state.authed) return send(state, { type: "error", message: "not authenticated" });
      void handle(state, msg);
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      clients.delete(state);
      if (listener === "tunnel") refreshTunnel();
    });
    ws.on("error", () => ws.terminate());
  });

  async function handle(state: ClientState, msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "ping":
          return send(state, { type: "pong", t: typeof msg.t === "number" ? msg.t : Date.now() });
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
        case "resize": {
          if (!isSafeId(msg.id)) return;
          // A PC-mirrored session keeps the PC console's size; phones and browsers follow it instead.
          if (sessions.get(msg.id)?.tags.includes("pc") && msg.owner !== true) return;
          sessions.resize(msg.id, Number(msg.cols), Number(msg.rows));
          return;
        }
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
            if (state.listener === "tunnel") return send(state, { type: "error", message: "원격 터널은 PC에서만 열 수 있습니다" });
            supervisor.log("action", null, "human", `원격 터널 시작 요청 (${msg.provider ?? "auto"})`);
            await tunnel.start(msg.provider);
          } else if (msg.action === "stop") {
            closeTunnel(state.listener === "tunnel" ? "원격 터널 종료(원격 기기에서)" : "원격 터널 종료", "human");
          }
          return send(state, { type: "tunnel", status: tunnel.status() });
        }
        case "refine": {
          const text = clampString(msg.text, 4000);
          if (!text.trim()) return send(state, { type: "error", message: "다듬을 지시가 비어 있습니다", reqId: msg.reqId });
          if (!aiLimiter.allow(state.client)) return send(state, { type: "error", message: "모델 호출이 너무 잦습니다. 잠시 뒤 다시 시도하세요", reqId: msg.reqId });
          try {
            return send(state, { type: "refine", result: await refine(text, typeof msg.cwd === "string" ? msg.cwd : undefined), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "worklog":
          return send(state, { type: "worklog", entries: worklog.list(msg.limit ?? 100), reqId: msg.reqId });
        case "worklog_summarize": {
          if (!isSafeId(msg.id)) return;
          if (!aiLimiter.allow(state.client)) return send(state, { type: "error", message: "모델 호출이 너무 잦습니다. 잠시 뒤 다시 시도하세요", reqId: msg.reqId });
          try {
            return send(state, { type: "worklog_entry", entry: await summarizeEntry(msg.id), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "products": {
          try {
            const r = await products.list(msg.refresh === true);
            return send(state, { type: "products", ...r, reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "playbook":
          return send(state, { type: "playbook", entries: playbook.search(typeof msg.query === "string" ? msg.query.slice(0, 200) : "", 50), reqId: msg.reqId });
        case "playbook_save": {
          try {
            const id = typeof msg.id === "string" ? msg.id : undefined;
            return send(state, { type: "playbook_entry", entry: playbook.save(msg.entry, id), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "playbook_draft": {
          if (!isSafeId(msg.id)) return;
          const entry = worklog.get(msg.id);
          if (!entry) return send(state, { type: "error", message: "작업 기록을 찾을 수 없습니다", reqId: msg.reqId });
          if (!aiLimiter.allow(state.client)) return send(state, { type: "error", message: "모델 호출이 너무 잦습니다. 잠시 뒤 다시 시도하세요", reqId: msg.reqId });
          try {
            return send(state, { type: "playbook_draft", draft: await playbook.draftFrom(entry), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "product_update":
        case "product_ping":
        case "product_insight": {
          const target = typeof msg.path === "string" ? msg.path.slice(0, 1024) : "";
          if (msg.type !== "product_update" && !aiLimiter.allow(state.client)) return send(state, { type: "error", message: "요청이 너무 잦습니다. 잠시 뒤 다시 시도하세요", reqId: msg.reqId });
          try {
            const product =
              msg.type === "product_update" ? await products.update(target, msg.patch ?? {}) : msg.type === "product_ping" ? await products.ping(target) : await products.insight(target);
            broadcast({ type: "product", product });
            return send(state, { type: "product", product, reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "cross_review": {
          if (!isSafeId(msg.id)) return;
          try {
            const reviewer = msg.reviewer === "codex" || msg.reviewer === "claude" ? msg.reviewer : "auto";
            return send(state, { type: "worklog_entry", entry: await startReview(msg.id, reviewer, msg.mode === "challenge" ? "challenge" : "review"), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
        }
        case "fs": {
          try {
            return send(state, { type: "fs", listing: listFolder(cfg.cwdRoot, typeof msg.path === "string" ? msg.path.slice(0, 1024) : null, folderContext()), reqId: msg.reqId });
          } catch (e) {
            return send(state, { type: "error", message: (e as Error).message, reqId: msg.reqId });
          }
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
    /** Port of the tunnel-only listener (0 until listen() resolves). */
    tunnelPort: () => boundTunnelPort,
    listen: async () => {
      const port = await new Promise<number>((resolve) => {
        server.listen(cfg.port, cfg.host, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : cfg.port);
        });
      });
      // The tunnel listener is loopback-only: only the local tunnel process connects to it.
      const bindTunnel = (p: number) =>
        new Promise<number>((resolve, reject) => {
          const onError = (e: Error) => reject(e);
          tunnelServer.once("error", onError);
          tunnelServer.listen(p, "127.0.0.1", () => {
            tunnelServer.off("error", onError);
            const addr = tunnelServer.address();
            resolve(typeof addr === "object" && addr ? addr.port : p);
          });
        });
      try {
        boundTunnelPort = await bindTunnel(cfg.tunnelPort);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || cfg.tunnelPort === 0) throw e;
        supervisor.log("warn", null, "system", `터널 전용 포트 ${cfg.tunnelPort} 사용 중, 빈 포트로 대신 엽니다`);
        boundTunnelPort = await bindTunnel(0);
      }
      return port;
    },
    /** Run one auto-close tick now (tests use this with an explicit clock). */
    tickTunnel,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        supervisor.stop();
        tunnel.stop();
        sessions.killAll();
        for (const c of clients) c.ws.close();
        wss.close();
        tunnelServer.close();
        server.close(() => resolve());
      }),
  };
}
