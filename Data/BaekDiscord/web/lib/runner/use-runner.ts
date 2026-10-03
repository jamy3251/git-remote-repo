"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatTurn,
  ClientMessage,
  CreateSessionRequest,
  Policy,
  PresetInfo,
  ServerMessage,
  SessionInfo,
  SupervisorConfig,
  SupervisorEvent,
  TunnelStatus,
  WorkspaceInfo,
} from "./protocol";
import { loadRunnerSettings, saveRunnerSettings, wsUrl, type RunnerSettings } from "./settings";

export type ConnectionStatus = "idle" | "connecting" | "open" | "unauthorized" | "closed";

export interface RunnerInfo {
  version: string;
  platform: string;
  cwdRoot: string;
}

type OutputListener = (data: string) => void;

export interface RunnerApi {
  settings: RunnerSettings;
  updateSettings: (s: RunnerSettings) => void;
  status: ConnectionStatus;
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
  /** Attach to a session's output stream; the runner replays history first. */
  subscribe: (id: string, listener: OutputListener) => () => void;
}

export function useRunner(): RunnerApi {
  const [settings, setSettings] = useState<RunnerSettings>(() => loadRunnerSettings());
  const [status, setStatus] = useState<ConnectionStatus>("idle");
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
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Map<string, Set<OutputListener>>());
  const manualClose = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest connect() for the reconnect timer (avoids referencing the callback before its declaration). */
  const connectRef = useRef<() => void>(() => {});

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const disconnect = useCallback(() => {
    manualClose.current = true;
    if (retry.current) clearTimeout(retry.current);
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("closed");
  }, []);

  const connect = useCallback(() => {
    const current = loadRunnerSettings();
    if (retry.current) clearTimeout(retry.current);
    wsRef.current?.close();
    manualClose.current = false;
    setLastError(null);
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
      for (const id of listeners.current.keys()) ws.send(JSON.stringify({ type: "attach", id } satisfies ClientMessage));
      ws.send(JSON.stringify({ type: "chat_history" } satisfies ClientMessage));
    };
    ws.onclose = (ev) => {
      if (wsRef.current !== ws) return;
      const unauthorized = ev.code === 4001 || ev.code === 4029;
      setStatus(unauthorized ? "unauthorized" : "closed");
      if (ev.code === 4001) setLastError("러너 토큰이 올바르지 않습니다.");
      if (ev.code === 4029) setLastError("인증 실패가 반복되어 잠시 잠겼습니다. 15분 뒤 다시 시도하세요.");
      // Auto-reconnect on network drops (phones sleep): not on auth failures or manual close.
      if (!unauthorized && !manualClose.current) retry.current = setTimeout(() => connectRef.current(), 4000);
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
      switch (msg.type) {
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
        case "error":
          setLastError(msg.message);
          if (msg.message === "invalid token") setStatus("unauthorized");
          break;
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
    return () => {
      manualClose.current = true;
      if (retry.current) clearTimeout(retry.current);
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

  return useMemo<RunnerApi>(
    () => ({
      settings,
      updateSettings,
      status,
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
      create: (req) => send({ type: "create", req, reqId: Math.random().toString(36).slice(2, 8) }),
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
      subscribe,
    }),
    [settings, updateSettings, status, info, presets, sessions, events, supervisor, tunnel, chat, chatBusy, workspaces, lastError, connect, disconnect, send, subscribe],
  );
}
