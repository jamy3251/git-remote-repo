/**
 * `npm run demo`: the real dashboard against a fake runner. Same WS protocol, fixed sample data,
 * no node-pty, no API key, no Claude, nothing written to disk, loopback only.
 * Any token is accepted because nothing here can touch the machine.
 */
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ChatTurn, ClientMessage, PresetInfo, ServerMessage, SessionInfo, SupervisorConfig, SupervisorEvent, TunnelStatus, WorkLogEntry, WorkspaceInfo } from "../protocol.js";
import { proxyHttp, proxyUpgrade } from "../proxy.js";

export const DEMO_TOKEN = "demo";
const CWD_ROOT = "C:\\demo";
const MIN = 60_000;

const presets: PresetInfo[] = [
  { id: "claude", label: "Claude Code", description: "대화형 Claude Code", mode: "pty", acceptsPrompt: true, available: true, internal: false },
  { id: "codex", label: "Codex", description: "대화형 Codex", mode: "pty", acceptsPrompt: true, available: true, internal: false },
  { id: "shell", label: "셸", description: "PowerShell / bash", mode: "pty", acceptsPrompt: false, available: true, internal: false },
];

function session(over: Partial<SessionInfo> & Pick<SessionInfo, "id" | "name" | "preset" | "cwd">, now: number): SessionInfo {
  return {
    command: over.preset,
    mode: "pty",
    status: "running",
    pid: null,
    exitCode: null,
    createdAt: now - 20 * MIN,
    endedAt: null,
    bytes: 48_000,
    tags: [],
    goal: null,
    policy: "assist",
    state: "working",
    stateReason: "",
    lastOutputAt: now - 5_000,
    lastLine: "",
    suggestion: null,
    cols: 100,
    rows: 30,
    ...over,
  };
}

/** Sample sessions: working, waiting for an answer (with a supervisor suggestion), error, finished. */
export function demoSessions(now: number): SessionInfo[] {
  return [
    session(
      {
        id: "demo-work",
        name: "결제 모듈 테스트 보강",
        preset: "claude",
        cwd: `${CWD_ROOT}\\shop-api`,
        goal: "결제 실패 경로 테스트를 추가하고 전부 통과시키기",
        state: "working",
        stateReason: "출력이 계속 나옴",
        lastLine: "✓ refund > rejects a second refund (12 ms)",
      },
      now,
    ),
    session(
      {
        id: "demo-wait",
        name: "로그인 화면 리팩터링",
        preset: "codex",
        cwd: `${CWD_ROOT}\\shop-web`,
        goal: "로그인 폼을 컴포넌트로 나누기",
        state: "waiting_input",
        stateReason: "확인 질문에서 멈춤",
        lastOutputAt: now - 4 * MIN,
        lastLine: "Apply these changes to 3 files? (y/n)",
        suggestion: {
          id: "demo-sg-1",
          createdAt: now - 4 * MIN,
          kind: "respond",
          input: "y\r",
          label: "y 입력 (변경 적용)",
          rationale: "목표 범위 안의 파일 3개만 바꾸는 확인 질문입니다. 위험 명령 없음.",
          confidence: 0.86,
          source: "heuristic",
        },
      },
      now,
    ),
    session(
      {
        id: "demo-err",
        name: "배포 스크립트 점검",
        preset: "shell",
        cwd: `${CWD_ROOT}\\infra`,
        policy: "manual",
        state: "error",
        stateReason: "오류 출력 감지",
        lastOutputAt: now - 9 * MIN,
        lastLine: "Error: ENOENT: no such file or directory, open '.env.production'",
      },
      now,
    ),
    session(
      {
        id: "demo-done",
        name: "README 오타 정리",
        preset: "claude",
        cwd: `${CWD_ROOT}\\docs-site`,
        status: "exited",
        exitCode: 0,
        createdAt: now - 70 * MIN,
        endedAt: now - 52 * MIN,
        state: "done",
        stateReason: "정상 종료",
        lastOutputAt: now - 52 * MIN,
        lastLine: "오타 7곳을 고쳤습니다.",
      },
      now,
    ),
  ];
}

const HISTORY: Record<string, string> = {
  "demo-work": [
    "\x1b[1m> 결제 실패 경로 테스트를 추가하고 전부 통과시켜 줘\x1b[0m",
    "",
    "테스트 파일을 살펴보겠습니다.",
    "  Read src/payments/refund.ts",
    "  Read test/refund.test.ts",
    "",
    "환불 중복 요청과 카드 거절 경로가 비어 있습니다. 테스트 4개를 추가합니다.",
    "  Edit test/refund.test.ts (+58)",
    "  Run npm test -- refund",
    "",
    "\x1b[32m✓\x1b[0m refund > refunds a captured payment (9 ms)",
    "\x1b[32m✓\x1b[0m refund > rejects a second refund (12 ms)",
    "",
  ].join("\r\n"),
  "demo-wait": [
    "\x1b[1m> 로그인 폼을 컴포넌트로 나눠 줘\x1b[0m",
    "",
    "Plan: split LoginForm into EmailField, PasswordField, SubmitRow.",
    "  src/login/LoginForm.tsx      | 120 ++----",
    "  src/login/EmailField.tsx     |  34 +++",
    "  src/login/PasswordField.tsx  |  41 +++",
    "",
    "\x1b[33mApply these changes to 3 files? (y/n)\x1b[0m ",
  ].join("\r\n"),
  "demo-err": [
    "PS C:\\demo\\infra> ./deploy.ps1 -DryRun",
    "Checking environment...",
    "\x1b[31mError: ENOENT: no such file or directory, open '.env.production'\x1b[0m",
    "PS C:\\demo\\infra> ",
  ].join("\r\n"),
  "demo-done": ["\x1b[1m> README 오타 정리해 줘\x1b[0m", "", "오타 7곳을 고쳤습니다.", ""].join("\r\n"),
};

const WORK_LINES = [
  "\x1b[32m✓\x1b[0m refund > rejects a declined card (15 ms)",
  "\x1b[32m✓\x1b[0m refund > keeps the ledger balanced after a failed refund (21 ms)",
  "  Edit src/payments/refund.ts (+6 -2)",
  "  Run npm test",
  "\x1b[32m✓\x1b[0m 42 passed (1.8 s)",
  "테스트 4개를 추가했고 전부 통과합니다. 변경 파일 2개.",
];

function worklogEntries(now: number): WorkLogEntry[] {
  return [
    {
      id: "demo-done",
      name: "README 오타 정리",
      preset: "claude",
      cwd: `${CWD_ROOT}\\docs-site`,
      goal: null,
      prompt: "README 오타 정리해 줘",
      startedAt: now - 70 * MIN,
      endedAt: now - 52 * MIN,
      status: "exited",
      exitCode: 0,
      bytes: 9_200,
      tail: ["오타 7곳을 고쳤습니다."],
      git: { branch: "main", insertions: 7, deletions: 7, files: ["README.md"] },
      summary: "README의 오타 7곳 수정, 다른 파일 변경 없음.",
      summarySource: "heuristic",
    },
  ];
}

const sampleEvents = (now: number): SupervisorEvent[] => [
  { id: 1, ts: now - 9 * MIN, sessionId: "demo-err", level: "warn", message: "오류 출력 감지: .env.production 없음", actor: "supervisor" },
  { id: 2, ts: now - 4 * MIN, sessionId: "demo-wait", level: "info", message: "입력 대기: 변경 적용 확인. 제안을 만들었습니다 (승인 필요)", actor: "supervisor" },
];

export interface DemoServerOptions {
  /** Next.js app to proxy pages from, e.g. http://127.0.0.1:3000. */
  webProxy: string | null;
  /** Fixed clock for tests. */
  now?: () => number;
  /** Interval for fake output on the working session; 0 disables. */
  tickMs?: number;
}

export function createDemoServer(opts: DemoServerOptions) {
  const now = opts.now ?? Date.now;
  const started = now();
  let sessions = demoSessions(started);
  const history = new Map(Object.entries(HISTORY));
  let events = sampleEvents(started);
  let eventId = events.length;
  const chat: ChatTurn[] = [];
  let workStep = 0;
  let created = 0;
  const supervisor: SupervisorConfig = {
    enabled: true,
    defaultPolicy: "assist",
    brain: "heuristic",
    brainModel: null,
    notifyWebhook: false,
    usage: { brainCalls: 0, brainErrors: 0, inputTokens: 0, outputTokens: 0 },
  };
  let tunnel: TunnelStatus = {
    provider: "ngrok",
    available: { ngrok: true, cloudflared: false },
    state: "running",
    url: "https://demo-devhub.example",
    qrSvg: null,
    error: null,
    startedAt: started - 10 * MIN,
    remoteClients: 1,
    closesAt: null,
  };
  const webTarget = opts.webProxy ? new URL(opts.webProxy) : null;
  const clients = new Set<WebSocket>();
  const attached = new WeakMap<WebSocket, Set<string>>();

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => {
    for (const ws of clients) send(ws, msg);
  };
  const output = (id: string, data: string) => {
    history.set(id, (history.get(id) ?? "") + data);
    for (const ws of clients) if (attached.get(ws)?.has(id)) send(ws, { type: "output", id, data });
  };
  const update = (id: string, patch: Partial<SessionInfo>) => {
    sessions = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
    const s = sessions.find((x) => x.id === id);
    if (s) broadcast({ type: "updated", session: s });
  };
  const log = (sessionId: string | null, level: SupervisorEvent["level"], message: string, actor: SupervisorEvent["actor"]) => {
    const event = { id: ++eventId, ts: now(), sessionId, level, message, actor };
    events = [...events.slice(-199), event];
    broadcast({ type: "event", event });
  };

  /** The waiting session got its answer: it moves on and finishes shortly after. */
  const answer = (id: string, text: string, actor: SupervisorEvent["actor"]) => {
    const s = sessions.find((x) => x.id === id);
    if (!s || s.status !== "running") return;
    output(id, `${text.replace(/\r/g, "")}\r\n`);
    if (s.state === "waiting_input") {
      update(id, { state: "working", stateReason: "답을 받음", suggestion: null, lastOutputAt: now(), lastLine: "변경을 적용하는 중..." });
      log(id, "action", `입력 전달: ${JSON.stringify(text.trim())}`, actor);
      output(id, "변경을 적용하는 중...\r\n");
    }
  };

  const welcome = { version: "demo", platform: process.platform, cwdRoot: CWD_ROOT, demo: true };
  const greet = (ws: WebSocket) => {
    send(ws, { type: "welcome", runner: welcome });
    send(ws, { type: "presets", presets });
    send(ws, { type: "sessions", sessions });
    send(ws, { type: "supervisor", config: supervisor });
    send(ws, { type: "tunnel", status: tunnel });
    send(ws, { type: "events", events });
  };

  function workspace(id: string): WorkspaceInfo | null {
    const s = sessions.find((x) => x.id === id);
    if (!s) return null;
    return {
      id,
      cwd: s.cwd,
      git: {
        repoRoot: s.cwd,
        branch: "feat/demo",
        ahead: 1,
        behind: 0,
        changed: [{ path: "test/refund.test.ts", status: "M", insertions: 58, deletions: 0 }],
        insertions: 58,
        deletions: 0,
        recentCommits: [{ sha: "a1b2c3d", subject: "결제 환불 경로 정리", when: "2 hours ago" }],
        checkedAt: now(),
      },
      activity: Array.from({ length: 60 }, (_, i) => (i > 40 ? 800 + ((i * 37) % 900) : 0)),
    };
  }

  function handle(ws: WebSocket, msg: ClientMessage): void {
    const reqId = "reqId" in msg ? msg.reqId : undefined;
    switch (msg.type) {
      case "ping":
        return send(ws, { type: "pong", t: msg.t });
      case "list":
        return send(ws, { type: "sessions", sessions });
      case "presets":
        return send(ws, { type: "presets", presets });
      case "attach":
        attached.get(ws)?.add(msg.id);
        return send(ws, { type: "history", id: msg.id, data: history.get(msg.id) ?? "" });
      case "detach":
        attached.get(ws)?.delete(msg.id);
        return;
      case "input":
        for (const id of msg.ids) answer(id, msg.data, "human");
        return;
      case "suggestion": {
        const s = sessions.find((x) => x.id === msg.id);
        if (!s?.suggestion || s.suggestion.id !== msg.suggestionId) return;
        if (msg.decision === "approve") answer(msg.id, s.suggestion.input ?? "", "human");
        else {
          update(msg.id, { suggestion: null });
          log(msg.id, "info", "제안을 무시했습니다", "human");
        }
        return;
      }
      case "kill":
        for (const id of msg.ids) {
          const s = sessions.find((x) => x.id === id);
          if (!s || s.status !== "running") continue;
          update(id, { status: "killed", state: "killed", endedAt: now(), suggestion: null });
          broadcast({ type: "exit", id, exitCode: null, status: "killed" });
        }
        return;
      case "remove":
        for (const id of msg.ids) {
          sessions = sessions.filter((s) => s.id !== id);
          broadcast({ type: "removed", id });
        }
        return;
      case "create": {
        const id = `demo-new-${++created}`;
        const preset = presets.find((p) => p.id === msg.req.preset) ? msg.req.preset : "claude";
        const s = session(
          {
            id,
            name: msg.req.name || msg.req.prompt?.slice(0, 30) || `새 작업 ${created}`,
            preset,
            cwd: msg.req.cwd || CWD_ROOT,
            goal: msg.req.goal ?? null,
            policy: msg.req.policy ?? "assist",
            createdAt: now(),
            bytes: 0,
            lastOutputAt: now(),
            lastLine: "데모 세션입니다. 실제로 실행되지 않습니다.",
          },
          now(),
        );
        sessions = [...sessions, s];
        history.set(id, `데모 세션입니다. 실제로 실행되지 않습니다.\r\n${msg.req.prompt ? `> ${msg.req.prompt}\r\n` : ""}`);
        send(ws, { type: "created", session: s, reqId: msg.reqId });
        broadcast({ type: "updated", session: s });
        return;
      }
      case "set_goal":
        return update(msg.id, { goal: msg.goal });
      case "set_policy":
        return update(msg.id, { policy: msg.policy });
      case "events":
        return send(ws, { type: "events", events: events.slice(-(msg.limit ?? 200)) });
      case "supervisor":
        if (typeof msg.enabled === "boolean") supervisor.enabled = msg.enabled;
        if (msg.defaultPolicy) supervisor.defaultPolicy = msg.defaultPolicy;
        return broadcast({ type: "supervisor", config: supervisor });
      case "chat": {
        const t = now();
        const user: ChatTurn = { id: chat.length + 1, role: "user", text: msg.text.slice(0, 4000), ts: t };
        const reply: ChatTurn = {
          id: chat.length + 2,
          role: "assistant",
          text: "데모에서는 관제 AI가 실제로 답하지 않습니다. 실제 러너에서는 세션 목록을 읽고, 세션을 만들고, 입력을 보내는 도구로 이 지시를 처리합니다.",
          ts: t,
        };
        chat.push(user, reply);
        broadcast({ type: "chat", turn: user });
        broadcast({ type: "chat", turn: reply });
        return;
      }
      case "chat_history":
        return send(ws, { type: "chat_history", turns: chat, busy: false });
      case "chat_reset":
        chat.length = 0;
        return broadcast({ type: "chat_history", turns: [], busy: false });
      case "tunnel":
        if (msg.action === "stop") {
          tunnel = { ...tunnel, state: "stopped", url: null, remoteClients: 0, startedAt: null, closesAt: null };
          broadcast({ type: "tunnel", status: tunnel });
        } else if (msg.action === "start") {
          send(ws, { type: "error", message: "데모에서는 원격 터널을 열 수 없습니다.", reqId });
        } else send(ws, { type: "tunnel", status: tunnel });
        return;
      case "workspace": {
        const info = workspace(msg.id);
        if (info) send(ws, { type: "workspace", info });
        return;
      }
      case "worklog":
        return send(ws, { type: "worklog", entries: worklogEntries(started), reqId });
      case "products":
        return send(ws, { type: "products", products: [], weeks: [], scannedAt: now(), reqId });
      case "playbook":
        return send(ws, { type: "playbook", entries: [], reqId });
      case "hello":
      case "resize":
        return;
      default:
        return send(ws, { type: "error", message: "데모에서는 이 기능이 동작하지 않습니다.", reqId });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/runner/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, demo: true, sessions: sessions.length }));
      return;
    }
    if (url.pathname.startsWith("/runner/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "데모 러너는 HTTP API를 제공하지 않습니다." }));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(302, { location: "/control#rt=demo" });
      res.end();
      return;
    }
    if (!webTarget) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("웹 앱 주소가 설정되지 않았습니다.");
      return;
    }
    proxyHttp(req, res, webTarget);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/runner/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        attached.set(ws, new Set());
        greet(ws);
        ws.on("message", (raw: Buffer) => {
          try {
            handle(ws, JSON.parse(raw.toString()) as ClientMessage);
          } catch {
            send(ws, { type: "error", message: "invalid JSON" });
          }
        });
        ws.on("close", () => clients.delete(ws));
        ws.on("error", () => ws.terminate());
      });
      return;
    }
    if (webTarget) return proxyUpgrade(req, socket, head, webTarget);
    socket.destroy();
  });

  // Keeps the working session alive on screen; finishes after the scripted lines.
  const tickMs = opts.tickMs ?? 4000;
  const ticker =
    tickMs > 0
      ? setInterval(() => {
          const s = sessions.find((x) => x.id === "demo-work");
          if (!s || s.status !== "running") return;
          const line = WORK_LINES[workStep % WORK_LINES.length];
          workStep++;
          output(s.id, `${line}\r\n`);
          update(s.id, { lastLine: line.replace(/\x1b\[[0-9;]*m/g, ""), lastOutputAt: now(), bytes: s.bytes + line.length });
          if (workStep % WORK_LINES.length === 0) output(s.id, "\r\n\x1b[2m(데모: 같은 출력이 반복됩니다)\x1b[0m\r\n");
        }, tickMs)
      : null;
  ticker?.unref?.();

  return {
    server,
    listen(port: number, host = "127.0.0.1"): Promise<number> {
      return new Promise((resolve, reject) => {
        const onError = (e: Error) => {
          server.off("listening", onListening);
          reject(e);
        };
        const onListening = () => {
          server.off("error", onError);
          const a = server.address();
          resolve(typeof a === "object" && a ? a.port : port);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    },
    close(): Promise<void> {
      if (ticker) clearInterval(ticker);
      for (const ws of clients) ws.terminate();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
