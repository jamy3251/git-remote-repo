type WsMessage =
  | { type: "agents_list"; agents: any[] }
  | { type: "agent_status"; agentId: string; status: string }
  | { type: "new_message"; agentId: string; message: any }
  | { type: "new_suggestion"; agentId: string; suggestion: any }
  | { type: "agent_settings_updated"; agentId: string; settings: any }
  | { type: "debate_started"; debate: any }
  | { type: "debate_updated"; debate: any }
  | { type: "debate_relay"; debateId: number; from: string; to: string; round: number }
  | { type: "pong" };

type WsHandler = (msg: WsMessage) => void;

let ws: WebSocket | null = null;
let handlers: Set<WsHandler> = new Set();
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function getWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    console.log("[WS] Connected");
    reconnectDelay = 1000;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      handlers.forEach((h) => h(msg));
    } catch (e) {
      console.error("[WS] Parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected, reconnecting in", reconnectDelay, "ms");
    ws = null;
    reconnectTimeout = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectWs();
    }, reconnectDelay);
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
    ws?.close();
  };
}

// Fallback: if WS fails 3+ times, switch to polling
let failCount = 0;
const MAX_WS_FAILS = 3;
let pollingInterval: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  if (pollingInterval) return;
  console.log("[WS] Switching to HTTP polling fallback");

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const agents = await res.json();
        handlers.forEach((h) => h({ type: "agents_list", agents }));
      }
    } catch {
      // ignore
    }
  }, 3000);
}

export function sendWs(msg: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function subscribeWs(handler: WsHandler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function disconnectWs() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  ws?.close();
  ws = null;
}
