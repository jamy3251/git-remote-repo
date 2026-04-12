import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChatBubble } from "~/components/ChatBubble";
import { connectWs, subscribeWs, sendWs } from "~/lib/ws.client";
import type { Agent, Message, Suggestion, AgentSettings } from "~/lib/db.server";
import type { Route } from "./+types/chat.$agentId";

export async function loader({ params }: Route.LoaderArgs) {
  const { getDb } = await import("~/lib/db.server");
  const db = getDb();
  const agent = db
    .prepare("SELECT * FROM agents WHERE id = ?")
    .get(params.agentId) as Agent | undefined;
  if (!agent) throw new Response("Agent not found", { status: 404 });

  const messages = db
    .prepare("SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC")
    .all(params.agentId) as Message[];

  const suggestions = db
    .prepare("SELECT * FROM suggestions WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 10")
    .all(params.agentId) as Suggestion[];

  let settings = db.prepare("SELECT * FROM agent_settings WHERE agent_id = ?").get(params.agentId) as AgentSettings | undefined;
  if (!settings) {
    const agentType = (params.agentId === "claude-code" || params.agentId === "codex") ? "cli" : "web";
    db.prepare("INSERT OR IGNORE INTO agent_settings (agent_id, agent_type) VALUES (?, ?)").run(params.agentId, agentType);
    settings = db.prepare("SELECT * FROM agent_settings WHERE agent_id = ?").get(params.agentId) as AgentSettings;
  }

  return { agent, messages, suggestions, settings };
}

export default function Chat({ loaderData }: Route.ComponentProps) {
  const [agent, setAgent] = useState<Agent>(loaderData.agent);
  const [messages, setMessages] = useState<Message[]>(loaderData.messages);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(loaderData.suggestions);
  const [settings, setSettings] = useState<AgentSettings>(loaderData.settings);
  const [input, setInput] = useState("");
  const [isAssistantMode, setIsAssistantMode] = useState(false);
  const [newMessageIds, setNewMessageIds] = useState<Set<number>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    connectWs();
    const unsub = subscribeWs((msg: any) => {
      if (msg.type === "new_message" && msg.agentId === agent.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.message.id)) return prev;
          return [...prev, msg.message];
        });
        setNewMessageIds((prev) => new Set(prev).add(msg.message.id));
      }
      if (msg.type === "agent_status" && msg.agentId === agent.id) {
        setAgent((prev) => ({ ...prev, status: msg.status }));
      }
      if (msg.type === "new_suggestion" && msg.agentId === agent.id) {
        setSuggestions((prev) => [msg.suggestion, ...prev].slice(0, 10));
      }
      if (msg.type === "agent_settings_updated" && msg.agentId === agent.id) {
        setSettings(msg.settings);
      }
    });
    return unsub;
  }, [agent.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const content = input.trim();
    if (!content) return;
    const role = isAssistantMode ? "assistant" : "user";
    sendWs({ type: "send_message", agentId: agent.id, content, role });
    if (role === "user") sendWs({ type: "update_status", agentId: agent.id, status: "working" });
    else sendWs({ type: "update_status", agentId: agent.id, status: "done" });
    setInput("");
    setIsAssistantMode(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleStatusChange(status: string) {
    sendWs({ type: "update_status", agentId: agent.id, status });
  }

  async function handleSuggestionAction(id: number, action: "accepted" | "dismissed") {
    await fetch(`/api/suggestions/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }

  function handleUseSuggestion(content: string) {
    setInput(content);
    setIsAssistantMode(false);
    inputRef.current?.focus();
  }

  async function toggleAutoAccept() {
    const newVal = !settings.auto_accept;
    const res = await fetch(`/api/agent-settings/${agent.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_accept: newVal }),
    });
    const updated = await res.json();
    setSettings(updated);
  }

  async function updateAgentType(type: string) {
    const res = await fetch(`/api/agent-settings/${agent.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_type: type }),
    });
    const updated = await res.json();
    setSettings(updated);
  }

  const isCli = settings.agent_type === "cli";

  return (
    <div className="courtroom-bg scanlines flex flex-col min-h-dvh">
      {/* Header */}
      <header className="pixel-card m-0 p-3 flex items-center gap-3"
        style={{ borderLeft: "none", borderRight: "none", borderTop: "none" }}>
        <Link to="/" className="pixel-btn text-xs py-1 px-3 no-underline">Back</Link>
        <div className="agent-avatar"
          style={{ borderColor: agent.color, color: agent.color, width: 40, height: 40, fontSize: 16 }}>
          {agent.name[0]}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base" style={{ color: agent.color }}>{agent.name}</span>
            <span className={`status-dot status-${agent.status}`} />
            {isCli && (
              <span style={{ background: "#333", color: "#4ade80", padding: "0 4px", fontSize: 9, border: "1px solid #4ade80" }}>CLI</span>
            )}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>{agent.role}</div>
        </div>
        <button onClick={() => setShowSettings(!showSettings)} className="pixel-btn text-xs py-1 px-2">
          {showSettings ? "X" : "Cfg"}
        </button>
        <div className="flex gap-1">
          {(["idle", "working", "done", "error"] as const).map((s) => (
            <button key={s} onClick={() => handleStatusChange(s)}
              className={`w-6 h-6 status-dot status-${s} cursor-pointer ${agent.status === s ? "ring-2 ring-white" : "opacity-50"}`}
              title={s} />
          ))}
        </div>
      </header>

      {/* Agent Settings Panel */}
      {showSettings && (
        <div className="pixel-card mx-3 mt-2 p-3" style={{ borderColor: agent.color }}>
          <div className="text-sm mb-3" style={{ color: agent.color }}>Agent Settings</div>

          {/* Agent Type */}
          <div className="flex gap-2 mb-3">
            <button onClick={() => updateAgentType("web")}
              className={`pixel-btn text-xs flex-1 ${!isCli ? "!border-white" : ""}`}
              style={!isCli ? { background: agent.color } : {}}>
              Web LLM
            </button>
            <button onClick={() => updateAgentType("cli")}
              className={`pixel-btn text-xs flex-1 ${isCli ? "!border-white" : ""}`}
              style={isCli ? { background: "#4ade80", color: "#000" } : {}}>
              CLI Agent
            </button>
          </div>

          {/* CLI-specific: Auto Accept */}
          {isCli && (
            <div className="flex items-center justify-between py-2" style={{ borderTop: "1px solid #333" }}>
              <div>
                <div className="text-xs" style={{ color: "var(--text-primary)" }}>Auto Accept</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  Automatically accept tool calls and file edits
                </div>
              </div>
              <button onClick={toggleAutoAccept}
                style={{
                  width: 48, height: 24, borderRadius: 0, border: "2px solid",
                  borderColor: settings.auto_accept ? "#4ade80" : "#666",
                  background: settings.auto_accept ? "#4ade80" : "#333",
                  position: "relative", cursor: "pointer", transition: "all 0.2s",
                }}>
                <div style={{
                  width: 16, height: 16, background: "#fff", position: "absolute", top: 2,
                  left: settings.auto_accept ? 26 : 2, transition: "left 0.2s",
                }} />
              </button>
            </div>
          )}

          {isCli && (
            <div className="text-xs mt-2 py-2" style={{ color: "var(--text-muted)", borderTop: "1px solid #333" }}>
              {settings.auto_accept ? (
                <span style={{ color: "#e2b714" }}>
                  Warning: Auto-accept is ON. All tool calls will be approved automatically.
                </span>
              ) : (
                <span>Each tool call requires manual approval.</span>
              )}
            </div>
          )}

          {/* Web LLM note */}
          {!isCli && (
            <div className="text-xs py-2" style={{ color: "var(--text-muted)", borderTop: "1px solid #333" }}>
              Suggestions from this AI will appear below when detected by the Chrome extension.
            </div>
          )}
        </div>
      )}

      {/* Suggestions Bar (Web LLM) */}
      {suggestions.length > 0 && !isCli && (
        <div className="px-3 py-2" style={{ borderBottom: "1px solid rgba(226,183,20,0.2)" }}>
          <div className="text-xs mb-2 flex items-center gap-2">
            <span style={{ color: agent.color }}>Suggestions</span>
            <span style={{ color: "var(--text-muted)", fontSize: 9 }}>from {agent.name}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {suggestions.map((s) => (
              <div key={s.id} style={{
                flexShrink: 0, maxWidth: 200, background: "rgba(245,240,224,0.1)",
                border: `1px solid ${agent.color}`, padding: "4px 8px",
                fontSize: 10, fontFamily: "'DungGeunMo', monospace",
              }}>
                <div style={{ color: "var(--text-primary)", marginBottom: 4, lineHeight: 1.3 }}>
                  {s.content.length > 60 ? s.content.slice(0, 60) + "..." : s.content}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { handleUseSuggestion(s.content); handleSuggestionAction(s.id, "accepted"); }}
                    style={{ background: agent.color, border: "none", color: "#fff", padding: "1px 6px", fontSize: 9, cursor: "pointer", fontFamily: "'DungGeunMo', monospace" }}>
                    Use
                  </button>
                  <button onClick={() => handleSuggestionAction(s.id, "dismissed")}
                    style={{ background: "none", border: "1px solid #666", color: "#666", padding: "1px 6px", fontSize: 9, cursor: "pointer", fontFamily: "'DungGeunMo', monospace" }}>
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>
            <div className="text-4xl mb-4">Court is in session</div>
            <div>{isCli ? "CLI output will appear here." : "Send a message or paste an AI response."}</div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} agent={agent} isNew={newMessageIds.has(msg.id)} />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="pixel-card m-0 p-3" style={{ borderLeft: "none", borderRight: "none", borderBottom: "none" }}>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setIsAssistantMode(false)}
            className={`pixel-btn text-xs flex-1 ${!isAssistantMode ? "!bg-indigo-600 !border-indigo-400" : ""}`}>
            Your Message
          </button>
          <button onClick={() => setIsAssistantMode(true)}
            className={`pixel-btn text-xs flex-1 ${isAssistantMode ? "!border-white" : ""}`}
            style={isAssistantMode ? { backgroundColor: agent.color, borderColor: agent.color } : {}}>
            {isCli ? "CLI Output" : "AI Answer"}
          </button>
        </div>
        <div className="flex gap-2">
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isAssistantMode ? (isCli ? "Paste CLI output..." : `Paste ${agent.name}'s answer...`) : "Enter your message..."}
            className="pixel-input flex-1 resize-none" rows={2}
            style={isAssistantMode ? { borderColor: agent.color } : { borderColor: "#6366f1" }} />
          <button onClick={handleSend} className="pixel-btn self-end">
            {isAssistantMode ? "Paste" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
