"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatTurn,
  ClientMessage,
  CreateSessionRequest,
  FolderOverlap,
  FsListing,
  Policy,
  PresetInfo,
  PlaybookEntry,
  PlaybookInput,
  Product,
  ProductMetaPatch,
  RefinedPrompt,
  ReviewMode,
  ReviewerId,
  ServerMessage,
  SessionInfo,
  SupervisorConfig,
  SupervisorEvent,
  TunnelStatus,
  WorkLogEntry,
  WorkspaceInfo,
} from "./protocol";
import { loadRunnerSettings, saveRunnerSettings, wsUrl, type RunnerSettings } from "./settings";
import { Backoff, PING_INTERVAL_MS, pongOverdue } from "./connection";
import { RunnerCallError, describeError } from "./labels";

/** reconnecting: dropped and a retry is scheduled (nextRetryAt); closed: stopped on purpose. */
export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "unauthorized" | "closed";

export interface RunnerInfo {
  version: string;
  platform: string;
  cwdRoot: string;
  /** Set by `npm run demo`: fake sessions, nothing runs on the PC. */
  demo?: boolean;
}

type OutputListener = (data: string) => void;

export interface RunnerApi {
  settings: RunnerSettings;
  updateSettings: (s: RunnerSettings) => void;
  status: ConnectionStatus;
  /** When the next automatic reconnect fires (status "reconnecting"). */
  nextRetryAt: number | null;
  /** Last ping round-trip to the runner in ms; null until the first pong. */
  rttMs: number | null;
  info: RunnerInfo | null;
  presets: PresetInfo[];
  sessions: SessionInfo[];
  events: SupervisorEvent[];
  supervisor: SupervisorConfig | null;
  tunnel: TunnelStatus | null;
  chat: ChatTurn[];
  chatBusy: boolean;
  workspaces: Record<string, WorkspaceInfo>;
  lastError: string | null;
  clearError: () => void;
  connect: () => void;
  disconnect: () => void;
  create: (req: CreateSessionRequest) => void;
  /** A create the runner held back because another session runs in an overlapping folder. */
  overlap: { req: CreateSessionRequest; overlaps: FolderOverlap[] } | null;
  /** Answer the held-back create: start anyway, or drop it. */
  resolveOverlap: (start: boolean) => void;
  input: (ids: string[], data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  setGoal: (id: string, goal: string | null) => void;
  setPolicy: (id: string, policy: Policy) => void;
  decideSuggestion: (id: string, suggestionId: string, decision: "approve" | "dismiss") => void;
  setSupervisor: (patch: { enabled?: boolean; defaultPolicy?: Policy }) => void;
  sendChat: (text: string, confirm?: boolean) => void;
  resetChat: () => void;
  tunnelAction: (action: "start" | "stop" | "status", provider?: "ngrok" | "cloudflared") => void;
  requestWorkspace: (id: string) => void;
  /** Child folders of `path` inside the runner root (folder picker). */
  listFolder: (path?: string) => Promise<FsListing>;
  /** Rewrite a rough instruction into an executable task (prompt model). */
  refine: (text: string, cwd?: string) => Promise<RefinedPrompt>;
  /** Finished sessions, newest first. */
  worklog: WorkLogEntry[];
  /** Ask the prompt model to summarize one finished session. */
  summarizeWork: (id: string) => Promise<WorkLogEntry>;
  /** Product portfolio (project folders); null until first loaded. */
  products: { list: Product[]; weeks: number[]; scannedAt: number } | null;
  loadProducts: (refresh?: boolean) => Promise<void>;
  updateProduct: (path: string, patch: ProductMetaPatch) => Promise<Product>;
  pingProduct: (path: string) => Promise<Product>;
  productInsight: (path: string) => Promise<Product>;
  /** Troubleshooting dictionary: search entries (empty query lists the newest). */
  searchPlaybook: (query: string) => Promise<PlaybookEntry[]>;
  savePlaybook: (entry: PlaybookInput, id?: string) => Promise<PlaybookEntry>;
  /** Draft a dictionary entry from a finished/failed work-log entry (prompt model). */
  draftPlaybook: (workId: string) => Promise<PlaybookInput>;
  /** Have a different AI review a finished session (read-only). */
  crossReview: (id: string, reviewer?: ReviewerId | "auto", mode?: ReviewMode) => Promise<WorkLogEntry>;
  /** Attach to a session's output stream; the runner replays history first. */
  subscribe: (id: string, listener: OutputListener) => () => void;
}

export function useRunner(): RunnerApi {
  const [settings, setSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [info, setInfo] = useState<RunnerInfo | null>(null);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [events, setEvents] = useState<SupervisorEvent[]>([]);
  const [supervisor, setSupervisorState] = useState<SupervisorConfig | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceInfo>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<{ req: CreateSessionRequest; overlaps: FolderOverlap[] } | null>(null);
  const overlapRef = useRef<{ req: CreateSessionRequest; overlaps: FolderOverlap[] } | null>(null);
  /** Creates sent and not yet answered, so a refusal can be offered again with the same request. */
  const creating = useRef(new Map<string, CreateSessionRequest>());
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Map<string, Set<OutputListener>>());
  const manualClose = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Exponential backoff between reconnects; reset once a socket opens. */
  const backoff = useRef(new Backoff());
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAckAt = useRef(0);
  /** Latest connect() for the reconnect timer (avoids referencing the callback before its declaration). */
  const connectRef = useRef<() => void>(() => {});
  const pending = useRef(new Map<string, { resolve: (m: ServerMessage) => void; reject: (e: Error) => void }>());
  const [worklog, setWorklog] = useState<WorkLogEntry[]>([]);
  const [products, setProducts] = useState<RunnerApi["products"]>(null);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const stopPing = () => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    pingTimer.current = null;
  };

  const disconnect = useCallback(() => {
    manualClose.current = true;
    if (retry.current) clearTimeout(retry.current);
    stopPing();
    wsRef.current?.close();
    wsRef.current = null;
    setNextRetryAt(null);
    setStatus("closed");
  }, []);

  const connect = useCallback(() => {
    const current = loadRunnerSettings();
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
    stopPing();
    wsRef.current?.close();
    manualClose.current = false;
    setLastError(null);
    setNextRetryAt(null);
    setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(current));
    } catch (e) {
      setLastError((e as Error).message);
      setStatus("closed");
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus("open");
      backoff.current.reset();
      lastAckAt.current = Date.now();
      // Liveness: ping on an interval; a socket that stops answering is closed so the backoff
      // reconnect takes over (half-open sockets after a phone sleeps otherwise look "connected").
      stopPing();
      pingTimer.current = setInterval(() => {
        if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
        if (pongOverdue(lastAckAt.current, Date.now())) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: "ping", t: Date.now() } satisfies ClientMessage));
      }, PING_INTERVAL_MS);
      for (const id of listeners.current.keys()) ws.send(JSON.stringify({ type: "attach", id } satisfies ClientMessage));
      ws.send(JSON.stringify({ type: "chat_history" } satisfies ClientMessage));
      ws.send(JSON.stringify({ type: "worklog", limit: 100 } satisfies ClientMessage));
    };
    ws.onclose = (ev) => {
      if (wsRef.current !== ws) return;
      stopPing();
      setRttMs(null);
      const unauthorized = ev.code === 4001 || ev.code === 4029;
      // The runner closed the remote tunnel: the address is gone, retrying it cannot succeed.
      const tunnelClosed = ev.code === 4005;
      if (ev.code === 4001) setLastError("러너 토큰이 올바르지 않습니다.");
      if (ev.code === 4029) setLastError("인증 실패가 반복되어 잠시 잠겼습니다. 15분 뒤 다시 시도하세요.");
      if (tunnelClosed) setLastError("원격 터널이 닫혔습니다. PC에서 다시 열고 QR을 다시 찍으세요.");
      // Auto-reconnect on network drops (phones sleep): not on auth failures, a closed tunnel or manual close.
      // Delay grows 1s → 30s with jitter and resets on the next successful open.
      if (!unauthorized && !tunnelClosed && !manualClose.current) {
        const delay = backoff.current.next();
        setStatus("reconnecting");
        setNextRetryAt(Date.now() + delay);
        retry.current = setTimeout(() => connectRef.current(), delay);
      } else {
        setNextRetryAt(null);
        setStatus(unauthorized ? "unauthorized" : "closed");
      }
    };
    ws.onerror = () => {
      if (wsRef.current === ws) setLastError("러너에 연결할 수 없습니다. 러너가 실행 중인지, URL과 토큰이 맞는지 확인하세요.");
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "pong") {
        lastAckAt.current = Date.now();
        setRttMs(Math.max(0, Date.now() - msg.t));
        return;
      }
      // Replies to request(): resolve the waiting promise instead of touching shared state.
      if ("reqId" in msg && msg.reqId && pending.current.has(msg.reqId) && msg.type !== "created") {
        const p = pending.current.get(msg.reqId)!;
        pending.current.delete(msg.reqId);
        if (msg.type === "error") p.reject(new RunnerCallError(msg));
        else p.resolve(msg);
        if (msg.type !== "worklog_entry" && msg.type !== "product" && msg.type !== "products") return;
      }
      switch (msg.type) {
        case "products":
          setProducts({ list: msg.products, weeks: msg.weeks, scannedAt: msg.scannedAt });
          break;
        case "product":
          setProducts((prev) => (prev ? { ...prev, list: prev.list.map((p) => (p.path === msg.product.path ? msg.product : p)) } : prev));
          break;
        case "worklog":
          setWorklog(msg.entries);
          break;
        case "worklog_entry":
          setWorklog((prev) => [msg.entry, ...prev.filter((e) => e.id !== msg.entry.id)].sort((a, b) => b.endedAt - a.endedAt));
          break;
        case "welcome":
          setInfo(msg.runner);
          break;
        case "presets":
          setPresets(msg.presets);
          break;
        case "sessions":
          setSessions(msg.sessions);
          break;
        case "created":
          if (msg.reqId) creating.current.delete(msg.reqId);
          setSessions((prev) => (prev.some((s) => s.id === msg.session.id) ? prev : [...prev, msg.session]));
          break;
        case "updated":
          // Upsert: a session created through the HTTP API (devhubctl, chat) first appears here.
          setSessions((prev) => (prev.some((s) => s.id === msg.session.id) ? prev.map((s) => (s.id === msg.session.id ? msg.session : s)) : [...prev, msg.session]));
          break;
        case "removed":
          setSessions((prev) => prev.filter((s) => s.id !== msg.id));
          setWorkspaces((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
          listeners.current.delete(msg.id);
          break;
        case "output":
        case "history":
          for (const l of listeners.current.get(msg.id) ?? []) l(msg.data);
          break;
        case "exit":
          setSessions((prev) => prev.map((s) => (s.id === msg.id ? { ...s, status: msg.status, exitCode: msg.exitCode, endedAt: Date.now() } : s)));
          break;
        case "event":
          setEvents((prev) => [...prev.slice(-499), msg.event]);
          break;
        case "events":
          setEvents(msg.events);
          break;
        case "supervisor":
          setSupervisorState(msg.config);
          break;
        case "tunnel":
          setTunnel(msg.status);
          break;
        case "chat":
          setChat((prev) => (prev.some((t) => t.id === msg.turn.id) ? prev : [...prev, msg.turn]));
          break;
        case "chat_history":
          setChat(msg.turns);
          setChatBusy(msg.busy);
          break;
        case "chat_status":
          setChatBusy(msg.busy);
          break;
        case "workspace":
          setWorkspaces((prev) => ({ ...prev, [msg.info.id]: msg.info }));
          break;
        case "error": {
          const held = msg.reqId ? creating.current.get(msg.reqId) : undefined;
          if (msg.reqId) creating.current.delete(msg.reqId);
          // Not a failure to report: the person is asked whether to start next to the running session.
          if (held && msg.code === "folder_busy") {
            overlapRef.current = { req: held, overlaps: msg.overlaps ?? [] };
            setOverlap(overlapRef.current);
            break;
          }
          setLastError(describeError(msg));
          if (msg.code === "auth_invalid" || msg.code === "auth_locked" || msg.message === "invalid token") setStatus("unauthorized");
          break;
        }
      }
    };
  }, []);

  useEffect(() => {
    connectRef.current = connect;
    const s = loadRunnerSettings();
    // Opening the socket on mount is the external-system sync this effect exists for;
    // connect() flips status to "connecting" as part of that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s.token) connect();
    // Coming back to the tab or regaining the network reconnects at once instead of waiting out
    // the backoff timer (what desktop apps do on power resume / visibility change).
    const wake = () => {
      if (manualClose.current || !loadRunnerSettings().token) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const ws = wsRef.current;
      const dead = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
      if (dead && retry.current) connectRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      manualClose.current = true;
      if (retry.current) clearTimeout(retry.current);
      stopPing();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      wsRef.current?.close();
    };
  }, [connect]);

  const updateSettings = useCallback((s: RunnerSettings) => {
    saveRunnerSettings(s);
    setSettings(s);
  }, []);

  const subscribe = useCallback(
    (id: string, listener: OutputListener) => {
      let set = listeners.current.get(id);
      const first = !set;
      if (!set) {
        set = new Set();
        listeners.current.set(id, set);
      }
      set.add(listener);
      if (first) send({ type: "attach", id });
      return () => {
        const cur = listeners.current.get(id);
        cur?.delete(listener);
        if (cur && cur.size === 0) {
          listeners.current.delete(id);
          send({ type: "detach", id });
        }
      };
    },
    [send],
  );

  const create = useCallback(
    (req: CreateSessionRequest) => {
      const reqId = Math.random().toString(36).slice(2, 8);
      creating.current.set(reqId, req);
      send({ type: "create", req, reqId });
    },
    [send],
  );
  const resolveOverlap = useCallback(
    (start: boolean) => {
      const held = overlapRef.current;
      overlapRef.current = null;
      setOverlap(null);
      if (held && start) create({ ...held.req, allowOverlap: true });
    },
    [create],
  );

  /** Send a message carrying a reqId and wait for the runner's reply to it. */
  const request = useCallback(
    (msg: ClientMessage & { reqId?: string }, timeoutMs = 10_000) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("러너에 연결되어 있지 않습니다"));
        const reqId = Math.random().toString(36).slice(2, 10);
        pending.current.set(reqId, { resolve, reject });
        ws.send(JSON.stringify({ ...msg, reqId }));
        setTimeout(() => {
          if (pending.current.delete(reqId)) reject(new Error("러너 응답이 없습니다"));
        }, timeoutMs);
      }),
    [],
  );
  const listFolder = useCallback(
    async (path?: string) => {
      const m = await request({ type: "fs", path });
      if (m.type !== "fs") throw new Error("unexpected reply");
      return m.listing;
    },
    [request],
  );
  // Prompt-model calls go through `claude -p` without an API key: allow a couple of minutes.
  const refine = useCallback(
    async (text: string, cwd?: string) => {
      const m = await request({ type: "refine", text, cwd }, 150_000);
      if (m.type !== "refine") throw new Error("unexpected reply");
      return m.result;
    },
    [request],
  );
  const summarizeWork = useCallback(
    async (id: string) => {
      const m = await request({ type: "worklog_summarize", id }, 150_000);
      if (m.type !== "worklog_entry") throw new Error("unexpected reply");
      return m.entry;
    },
    [request],
  );

  const loadProducts = useCallback(
    async (refresh = false) => {
      await request({ type: "products", refresh }, 60_000);
    },
    [request],
  );
  const productCall = useCallback(
    async (msg: ClientMessage, timeoutMs: number) => {
      const m = await request(msg, timeoutMs);
      if (m.type !== "product") throw new Error("unexpected reply");
      return m.product;
    },
    [request],
  );
  const updateProduct = useCallback((path: string, patch: ProductMetaPatch) => productCall({ type: "product_update", path, patch }, 15_000), [productCall]);
  const pingProduct = useCallback((path: string) => productCall({ type: "product_ping", path }, 20_000), [productCall]);
  const productInsight = useCallback((path: string) => productCall({ type: "product_insight", path }, 150_000), [productCall]);

  const searchPlaybook = useCallback(
    async (query: string) => {
      const m = await request({ type: "playbook", query }, 15_000);
      if (m.type !== "playbook") throw new Error("unexpected reply");
      return m.entries;
    },
    [request],
  );
  const savePlaybook = useCallback(
    async (entry: PlaybookInput, id?: string) => {
      const m = await request({ type: "playbook_save", entry, id }, 15_000);
      if (m.type !== "playbook_entry") throw new Error("unexpected reply");
      return m.entry;
    },
    [request],
  );
  const draftPlaybook = useCallback(
    async (workId: string) => {
      const m = await request({ type: "playbook_draft", id: workId }, 150_000);
      if (m.type !== "playbook_draft") throw new Error("unexpected reply");
      return m.draft;
    },
    [request],
  );

  const crossReview = useCallback(
    async (id: string, reviewer: ReviewerId | "auto" = "auto", mode: ReviewMode = "review") => {
      const m = await request({ type: "cross_review", id, reviewer, mode }, 30_000);
      if (m.type !== "worklog_entry") throw new Error("unexpected reply");
      return m.entry;
    },
    [request],
  );

  return useMemo<RunnerApi>(
    () => ({
      settings,
      updateSettings,
      status,
      nextRetryAt,
      rttMs,
      info,
      presets,
      sessions,
      events,
      supervisor,
      tunnel,
      chat,
      chatBusy,
      workspaces,
      lastError,
      clearError: () => setLastError(null),
      connect,
      disconnect,
      create,
      overlap,
      resolveOverlap,
      input: (ids, data) => send({ type: "input", ids, data }),
      resize: (id, cols, rows) => send({ type: "resize", id, cols, rows }),
      kill: (ids) => send({ type: "kill", ids }),
      remove: (ids) => send({ type: "remove", ids }),
      setGoal: (id, goal) => send({ type: "set_goal", id, goal }),
      setPolicy: (id, policy) => send({ type: "set_policy", id, policy }),
      decideSuggestion: (id, suggestionId, decision) => send({ type: "suggestion", id, suggestionId, decision }),
      setSupervisor: (patch) => send({ type: "supervisor", ...patch }),
      sendChat: (text, confirm) => send({ type: "chat", text, confirm }),
      resetChat: () => send({ type: "chat_reset" }),
      tunnelAction: (action, provider) => send({ type: "tunnel", action, provider }),
      requestWorkspace: (id) => send({ type: "workspace", id }),
      listFolder,
      refine,
      worklog,
      summarizeWork,
      crossReview,
      searchPlaybook,
      savePlaybook,
      draftPlaybook,
      products,
      loadProducts,
      updateProduct,
      pingProduct,
      productInsight,
      subscribe,
    }),
    [settings, updateSettings, status, nextRetryAt, rttMs, info, presets, sessions, events, supervisor, tunnel, chat, chatBusy, workspaces, lastError, connect, disconnect, send, create, overlap, resolveOverlap, subscribe, listFolder, refine, worklog, summarizeWork, crossReview, searchPlaybook, savePlaybook, draftPlaybook, products, loadProducts, updateProduct, pingProduct, productInsight],
  );
}
