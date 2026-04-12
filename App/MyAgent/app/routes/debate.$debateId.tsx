import { useEffect, useState, useRef } from "react";
import { Link } from "react-router";
import { connectWs, subscribeWs } from "~/lib/ws.client";
import type { Agent, Message } from "~/lib/db.server";
import type { Route } from "./+types/debate.$debateId";

interface Debate {
  id: number;
  topic: string;
  rules: string;
  agents: string;
  status: string;
  current_turn: string;
  round: number;
  max_rounds: number;
}

export async function loader({ params }: Route.LoaderArgs) {
  const { getDb } = await import("~/lib/db.server");
  const db = getDb();

  const debate = db.prepare("SELECT * FROM debates WHERE id = ?").get(params.debateId) as Debate | undefined;
  if (!debate) throw new Response("Debate not found", { status: 404 });

  const agentIds = JSON.parse(debate.agents) as string[];
  const agents = agentIds.map(
    (id) => db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent
  ).filter(Boolean);

  const messages = db.prepare(
    `SELECT * FROM messages WHERE agent_id IN (${agentIds.map(() => "?").join(",")}) AND created_at >= ? ORDER BY created_at ASC`
  ).all(...agentIds, debate.created_at) as Message[];

  return { debate, agents, messages };
}

export default function DebateViewer({ loaderData }: Route.ComponentProps) {
  const [debate, setDebate] = useState<Debate>(loaderData.debate);
  const [agents] = useState<Agent[]>(loaderData.agents);
  const [messages, setMessages] = useState<Message[]>(loaderData.messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  useEffect(() => {
    connectWs();
    const unsub = subscribeWs((msg: any) => {
      // New message from any debate agent
      if (msg.type === "new_message") {
        const agentIds = JSON.parse(debate.agents) as string[];
        if (agentIds.includes(msg.agentId)) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.message.id)) return prev;
            return [...prev, msg.message];
          });
        }
      }
      // Debate state updates
      if (msg.type === "debate_updated" && msg.debate?.id === debate.id) {
        setDebate(msg.debate);
      }
      if (msg.type === "debate_relay" && msg.debateId === debate.id) {
        setDebate((prev) => ({ ...prev, current_turn: msg.to, round: msg.round }));
      }
    });
    return unsub;
  }, [debate.id, debate.agents]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleControl(action: string) {
    await fetch(`/api/debates/${debate.id}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  const currentAgent = agentMap.get(debate.current_turn);
  const isActive = debate.status === "active";
  const isFinished = debate.status === "finished";

  return (
    <div className="courtroom-bg scanlines flex flex-col min-h-dvh">
      {/* Header */}
      <header className="pixel-card m-0 p-3 flex items-center gap-3"
        style={{ borderLeft: "none", borderRight: "none", borderTop: "none" }}>
        <Link to="/" className="pixel-btn text-xs py-1 px-3 no-underline">Back</Link>
        <div className="flex-1">
          <div className="text-sm crt-glow" style={{ color: "var(--accent-gold)" }}>
            AI DEBATE
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {debate.topic.length > 40 ? debate.topic.slice(0, 40) + "..." : debate.topic}
          </div>
        </div>
        <div className="flex gap-2">
          {isActive && (
            <>
              <button onClick={() => handleControl("pause")} className="pixel-btn text-xs py-1 px-2">
                Pause
              </button>
              <button onClick={() => handleControl("stop")} className="pixel-btn pixel-btn-red text-xs py-1 px-2">
                Stop
              </button>
            </>
          )}
          {debate.status === "paused" && (
            <button onClick={() => handleControl("resume")} className="pixel-btn text-xs py-1 px-2">
              Resume
            </button>
          )}
        </div>
      </header>

      {/* Debate info bar */}
      <div className="px-4 py-2 flex items-center justify-between text-xs"
        style={{ borderBottom: "1px solid rgba(226,183,20,0.2)" }}>
        <div className="flex gap-3">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-1">
              <div className="agent-avatar"
                style={{ borderColor: a.color, color: a.color, width: 24, height: 24, fontSize: 10 }}>
                {a.name[0]}
              </div>
              <span style={{ color: a.color }}>{a.name}</span>
              {debate.current_turn === a.id && isActive && (
                <span style={{ color: "var(--accent-gold)", animation: "blink 1s step-start infinite" }}>
                  typing...
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          Round {debate.round}/{debate.max_rounds}
          {isFinished && <span style={{ color: "#4ade80", marginLeft: 8 }}>FINISHED</span>}
          {debate.status === "paused" && <span style={{ color: "var(--accent-gold)", marginLeft: 8 }}>PAUSED</span>}
        </div>
      </div>

      {/* Topic banner */}
      <div className="mx-4 mt-3 pixel-card p-3" style={{ borderColor: "var(--accent-red)" }}>
        <div className="text-xs mb-1" style={{ color: "var(--accent-red)" }}>TOPIC</div>
        <div className="text-sm">{debate.topic}</div>
        {debate.rules && (
          <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            Rules: {debate.rules}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && isActive && (
          <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
            <div className="text-2xl mb-2" style={{ color: "var(--accent-gold)" }}>
              Waiting for first response...
            </div>
            <div className="text-xs">
              Make sure {agents.map((a) => a.name).join(" and ")} tabs are open in Chrome
            </div>
          </div>
        )}

        {messages.filter((m) => m.role === "assistant").map((msg, idx) => {
          const agent = agentMap.get(msg.agent_id);
          if (!agent) return null;
          const isLeft = idx % 2 === 0;

          return (
            <div key={msg.id} className={`mb-4 ${idx === messages.length - 1 ? "slide-in-left" : ""}`}>
              <div className={`flex items-start gap-3 ${!isLeft ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div className="agent-avatar shrink-0"
                  style={{ borderColor: agent.color, color: agent.color, width: 48, height: 48, fontSize: 20 }}>
                  {agent.name[0]}
                </div>

                <div className={`flex-1 ${!isLeft ? "text-right" : ""}`}>
                  {/* Name + round */}
                  <div className="text-xs mb-1 flex items-center gap-2"
                    style={{ color: agent.color, justifyContent: isLeft ? "flex-start" : "flex-end" }}>
                    <span>{agent.name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 9 }}>
                      Round {Math.floor(idx / agents.length) + 1}
                    </span>
                  </div>

                  {/* Speech bubble */}
                  <div className="speech-bubble" style={{ borderColor: agent.color }}>
                    {msg.content.split("\n").map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < msg.content.split("\n").length - 1 && <br />}
                      </span>
                    ))}
                  </div>

                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {new Date(msg.created_at + "Z").toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isActive && currentAgent && (
          <div className="flex items-center gap-2 py-4">
            <div className="agent-avatar"
              style={{ borderColor: currentAgent.color, color: currentAgent.color, width: 32, height: 32, fontSize: 14 }}>
              {currentAgent.name[0]}
            </div>
            <span className="text-xs" style={{ color: currentAgent.color }}>
              {currentAgent.name}
            </span>
            <span className="text-xs" style={{ color: "var(--accent-gold)", animation: "blink 1s step-start infinite" }}>
              is thinking...
            </span>
          </div>
        )}

        {/* Finished banner */}
        {isFinished && messages.length > 0 && (
          <div className="text-center py-6">
            <div className="objection" style={{ fontSize: 24 }}>DEBATE CONCLUDED</div>
            <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              {messages.filter((m) => m.role === "assistant").length} messages over {debate.max_rounds} rounds
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>
    </div>
  );
}
