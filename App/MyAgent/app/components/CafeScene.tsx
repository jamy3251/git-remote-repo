import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { PixelCharacter } from "./PixelCharacter";
import type { Agent } from "~/lib/db.server";
import type { SeoulWeather } from "~/lib/weather.server";

// ============================================================
// Furniture Components
// ============================================================

function Table({ x, y, id }: { x: number; y: number; id: string }) {
  return (
    <div data-table-id={id} style={{ position: "absolute", left: x, top: y, zIndex: y + 10 }}>
      <div style={{ width: 52, height: 26, background: "#8B6914", border: "2px solid #6B4F12", boxShadow: "0 4px 0 #5A3E0E" }} />
      <div style={{ width: 4, height: 12, background: "#6B4F12", position: "absolute", bottom: -12, left: 4 }} />
      <div style={{ width: 4, height: 12, background: "#6B4F12", position: "absolute", bottom: -12, right: 4 }} />
    </div>
  );
}

function Chair({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 5, transform: flip ? "scaleX(-1)" : undefined }}>
      <div style={{ width: 20, height: 10, background: "#A0522D", border: "1px solid #7B3F1E" }} />
      <div style={{ width: 4, height: 18, background: "#8B4513", position: "absolute", top: -12, left: 0 }} />
      <div style={{ width: 3, height: 8, background: "#7B3F1E", position: "absolute", bottom: -8, right: 2 }} />
    </div>
  );
}

function Plant({ x, y, big }: { x: number; y: number; big?: boolean }) {
  const s = big ? 1.4 : 1;
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 5, transform: `scale(${s})`, transformOrigin: "bottom center" }}>
      <div style={{ width: 16, height: 14, background: "#CD853F", border: "2px solid #A0522D", borderRadius: "0 0 4px 4px" }} />
      <div style={{ width: 24, height: 20, background: "#228B22", borderRadius: "50%", position: "absolute", top: -16, left: -4, boxShadow: "inset -4px -2px 0 #1a6b1a" }} />
    </div>
  );
}

function Counter({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 5 }}>
      <div style={{ width, height: 20, background: "#D2691E", border: "2px solid #8B4513", boxShadow: "0 4px 0 #6B3410" }} />
      <div style={{ width, height: 24, background: "#8B4513", border: "2px solid #6B3410", borderTop: "none", position: "absolute", top: 20 }} />
      <div style={{ width: 14, height: 18, background: "#444", border: "2px solid #333", position: "absolute", top: -18, left: 10 }} />
      {/* cups on counter */}
      <div style={{ width: 8, height: 8, background: "#f5f5dc", border: "1px solid #ccc", borderRadius: "0 0 2px 2px", position: "absolute", top: -8, left: 32 }} />
      <div style={{ width: 8, height: 8, background: "#f5f5dc", border: "1px solid #ccc", borderRadius: "0 0 2px 2px", position: "absolute", top: -8, left: 48 }} />
    </div>
  );
}

function Bookshelf({ x, y }: { x: number; y: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 3 }}>
      <div style={{ width: 40, height: 50, background: "#5C3317", border: "2px solid #3E2010" }}>
        {/* shelves */}
        <div style={{ width: "100%", height: 2, background: "#3E2010", position: "absolute", top: 16 }} />
        <div style={{ width: "100%", height: 2, background: "#3E2010", position: "absolute", top: 32 }} />
        {/* books */}
        <div style={{ position: "absolute", top: 2, left: 3, width: 6, height: 13, background: "#e94560" }} />
        <div style={{ position: "absolute", top: 2, left: 11, width: 5, height: 13, background: "#4285F4" }} />
        <div style={{ position: "absolute", top: 2, left: 18, width: 7, height: 13, background: "#e2b714" }} />
        <div style={{ position: "absolute", top: 2, left: 27, width: 5, height: 13, background: "#10A37F" }} />
        <div style={{ position: "absolute", top: 19, left: 4, width: 8, height: 12, background: "#7C3AED" }} />
        <div style={{ position: "absolute", top: 19, left: 14, width: 6, height: 12, background: "#20B2AA" }} />
        <div style={{ position: "absolute", top: 19, left: 22, width: 7, height: 12, background: "#CD853F" }} />
        <div style={{ position: "absolute", top: 35, left: 5, width: 6, height: 12, background: "#FF6B6B" }} />
        <div style={{ position: "absolute", top: 35, left: 13, width: 8, height: 12, background: "#333" }} />
        <div style={{ position: "absolute", top: 35, left: 24, width: 5, height: 12, background: "#48BB78" }} />
      </div>
    </div>
  );
}

function Lamp({ x, y, on }: { x: number; y: number; on?: boolean }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 3 }}>
      {on && <div style={{ position: "absolute", top: -10, left: -12, width: 30, height: 30, background: "radial-gradient(circle, rgba(226,183,20,0.15) 0%, transparent 70%)", pointerEvents: "none" }} />}
      <div style={{ width: 3, height: 20, background: "#555", position: "absolute", bottom: 0, left: 3 }} />
      <div style={{ width: 12, height: 8, background: on ? "#e2b714" : "#888", border: "1px solid #666", borderRadius: "4px 4px 0 0", position: "absolute", bottom: 20, left: -2 }} />
      <div style={{ width: 8, height: 3, background: "#444", position: "absolute", bottom: -1, left: 0 }} />
    </div>
  );
}

function CatNpc({ x, y }: { x: number; y: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => { const iv = setInterval(() => setFrame((f) => (f + 1) % 4), 800); return () => clearInterval(iv); }, []);
  const tailWag = frame % 2 === 0 ? -3 : 3;
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: y + 5 }}>
      <div style={{ width: 20, height: 12, background: "#F5A623", border: "1px solid #D4891A", borderRadius: 2 }} />
      <div style={{ width: 14, height: 12, background: "#F5A623", border: "1px solid #D4891A", position: "absolute", top: -6, left: -4, borderRadius: 2 }} />
      <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: "6px solid #F5A623", position: "absolute", top: -12, left: -4 }} />
      <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: "6px solid #F5A623", position: "absolute", top: -12, left: 4 }} />
      <div style={{ position: "absolute", top: -1, left: -1, width: 2, height: frame === 3 ? 1 : 3, background: "#333", boxShadow: "6px 0 0 #333" }} />
      <div style={{ width: 3, height: 10, background: "#F5A623", position: "absolute", top: -4, right: -4, borderRadius: "0 4px 0 0", transform: `rotate(${tailWag}deg)`, transformOrigin: "bottom left" }} />
      {frame === 0 && <div style={{ position: "absolute", top: -18, right: -8, fontSize: 8, fontFamily: "'DungGeunMo', monospace", color: "#aaa" }}>z</div>}
    </div>
  );
}

function Painting({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 5 }}>
      <div style={{ width: 24, height: 18, background: color, border: "2px solid #8B6914", boxShadow: "1px 1px 0 rgba(0,0,0,0.3)" }}>
        <div style={{ width: 8, height: 6, background: "rgba(255,255,255,0.15)", position: "absolute", top: 3, left: 3 }} />
      </div>
    </div>
  );
}

// ============================================================
// Sky / Weather Background
// ============================================================

function SkyBackground({ weather }: { weather: SeoulWeather }) {
  const { hour, icon, isDay } = weather;

  // Sky gradient based on time
  let skyTop: string, skyBot: string;
  if (hour >= 5 && hour < 7) { // sunrise
    skyTop = "#1a1a3e"; skyBot = "#FF8C42";
  } else if (hour >= 7 && hour < 17) { // daytime
    skyTop = "#4A90D9"; skyBot = "#87CEEB";
  } else if (hour >= 17 && hour < 19) { // sunset
    skyTop = "#2D1B69"; skyBot = "#FF6B35";
  } else { // night
    skyTop = "#0a0a1e"; skyBot = "#1a1a3e";
  }

  // Override for weather
  if (icon === "rain" || icon === "thunder") {
    skyTop = isDay ? "#4a4a5a" : "#0a0a15";
    skyBot = isDay ? "#6a6a7a" : "#1a1a25";
  } else if (icon === "cloudy" || icon === "fog") {
    skyTop = isDay ? "#6a7a8a" : "#15152a";
    skyBot = isDay ? "#8a9aaa" : "#1a1a30";
  }

  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 70, background: `linear-gradient(180deg, ${skyTop} 0%, ${skyBot} 80%, #3d2b1a 100%)`, borderBottom: "3px solid #8B6914", overflow: "hidden" }}>
      {/* Sun/Moon */}
      {isDay && icon !== "rain" && icon !== "thunder" && (
        <div style={{ position: "absolute", top: 8, right: 30, width: 14, height: 14, background: "#FFD700", borderRadius: "50%", boxShadow: "0 0 8px rgba(255,215,0,0.4)" }} />
      )}
      {!isDay && (
        <div style={{ position: "absolute", top: 10, right: 25, width: 10, height: 10, background: "#e2e8f0", borderRadius: "50%", boxShadow: "0 0 6px rgba(226,232,240,0.3)" }} />
      )}

      {/* Stars at night */}
      {!isDay && <>
        <div style={{ position: "absolute", top: 8, left: "15%", width: 2, height: 2, background: "#fff", opacity: 0.8 }} />
        <div style={{ position: "absolute", top: 20, left: "35%", width: 2, height: 2, background: "#fff", opacity: 0.6 }} />
        <div style={{ position: "absolute", top: 6, left: "55%", width: 2, height: 2, background: "#fff", opacity: 0.9 }} />
        <div style={{ position: "absolute", top: 25, left: "70%", width: 2, height: 2, background: "#fff", opacity: 0.5 }} />
        <div style={{ position: "absolute", top: 12, left: "85%", width: 2, height: 2, background: "#fff", opacity: 0.7 }} />
        <div style={{ position: "absolute", top: 30, left: "25%", width: 1, height: 1, background: "#fff", opacity: 0.4 }} />
        <div style={{ position: "absolute", top: 15, left: "45%", width: 1, height: 1, background: "#fff", opacity: 0.6 }} />
      </>}

      {/* Clouds */}
      {(icon === "cloudy" || icon === "rain" || icon === "thunder" || icon === "snow") && <>
        <div style={{ position: "absolute", top: 8, left: "10%", width: 40, height: 14, background: isDay ? "rgba(200,200,200,0.7)" : "rgba(60,60,80,0.7)", borderRadius: 6 }} />
        <div style={{ position: "absolute", top: 14, left: "30%", width: 50, height: 16, background: isDay ? "rgba(180,180,180,0.7)" : "rgba(50,50,70,0.7)", borderRadius: 8 }} />
        <div style={{ position: "absolute", top: 6, left: "60%", width: 35, height: 12, background: isDay ? "rgba(190,190,190,0.7)" : "rgba(55,55,75,0.7)", borderRadius: 6 }} />
      </>}

      {/* Rain drops */}
      {(icon === "rain" || icon === "thunder") && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              left: `${(i * 7 + 3) % 100}%`,
              top: -4,
              width: 1,
              height: 6,
              background: "rgba(150,180,255,0.5)",
              animation: `rainDrop ${0.5 + Math.random() * 0.3}s linear infinite`,
              animationDelay: `${Math.random() * 0.5}s`,
            }} />
          ))}
        </div>
      )}

      {/* Snow */}
      {icon === "snow" && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} style={{
              position: "absolute",
              left: `${(i * 9 + 2) % 100}%`,
              top: -4,
              width: 3,
              height: 3,
              background: "#fff",
              borderRadius: "50%",
              animation: `snowFall ${1.5 + Math.random() * 1}s linear infinite`,
              animationDelay: `${Math.random() * 1.5}s`,
            }} />
          ))}
        </div>
      )}

      {/* Lightning flash */}
      {icon === "thunder" && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.05)", animation: "lightning 4s ease-in-out infinite", pointerEvents: "none" }} />
      )}
    </div>
  );
}

// ============================================================
// Debate Order Sheet (Toast UI when agents dropped on table)
// ============================================================

interface DebateTable {
  tableId: string;
  x: number;
  y: number;
  seats: { agentId: string | null }[];
}

interface DebateSession {
  tableId: string;
  agents: string[];
  topic: string;
  rules: string;
  active: boolean;
}

function OrderSheet({
  table,
  agents,
  session,
  onClose,
  onStart,
  onUpdateTopic,
  onUpdateRules,
  onRemoveAgent,
}: {
  table: DebateTable;
  agents: Agent[];
  session: DebateSession | null;
  onClose: () => void;
  onStart: () => void;
  onUpdateTopic: (t: string) => void;
  onUpdateRules: (r: string) => void;
  onRemoveAgent: (id: string) => void;
}) {
  const seatedAgents = table.seats.map((s) => agents.find((a) => a.id === s.agentId)).filter(Boolean) as Agent[];

  return (
    <div style={{
      position: "absolute",
      left: table.x - 40,
      top: table.y - 180,
      width: 200,
      zIndex: 9999,
      fontFamily: "'DungGeunMo', monospace",
    }}>
      <div style={{
        background: "#f5f0e0",
        border: "3px solid #8B6914",
        padding: 12,
        boxShadow: "4px 4px 0 rgba(0,0,0,0.3)",
        color: "#333",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: "bold", color: "#5C3317" }}>ORDER SHEET</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontFamily: "'DungGeunMo', monospace", fontSize: 14 }}>X</button>
        </div>

        {/* Seated agents */}
        <div style={{ marginBottom: 8, fontSize: 11, color: "#666" }}>Participants:</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
          {seatedAgents.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 3, background: "#fff", border: `2px solid ${a.color}`, padding: "2px 6px", fontSize: 10 }}>
              <span style={{ color: a.color }}>{a.name}</span>
              <button onClick={() => onRemoveAgent(a.id)} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", fontSize: 10, padding: 0 }}>x</button>
            </div>
          ))}
          {seatedAgents.length < MAX_SEATS && (
            <div style={{ fontSize: 10, color: "#aaa", padding: "2px 6px", border: "1px dashed #ccc" }}>
              Drag AI here ({seatedAgents.length}/{MAX_SEATS})
            </div>
          )}
        </div>

        {/* Topic */}
        <div style={{ marginBottom: 4, fontSize: 11, color: "#666" }}>Topic:</div>
        <textarea
          value={session?.topic || ""}
          onChange={(e) => onUpdateTopic(e.target.value)}
          placeholder="What should they debate?"
          style={{ width: "100%", height: 40, background: "#fff", border: "2px solid #ccc", padding: 4, fontFamily: "'DungGeunMo', monospace", fontSize: 11, resize: "none", color: "#333" }}
        />

        {/* Rules */}
        <div style={{ marginBottom: 4, marginTop: 6, fontSize: 11, color: "#666" }}>Rules:</div>
        <textarea
          value={session?.rules || ""}
          onChange={(e) => onUpdateRules(e.target.value)}
          placeholder="e.g. Each side gets 3 turns, keep it under 100 words..."
          style={{ width: "100%", height: 36, background: "#fff", border: "2px solid #ccc", padding: 4, fontFamily: "'DungGeunMo', monospace", fontSize: 10, resize: "none", color: "#333" }}
        />

        {/* Start button */}
        {seatedAgents.length >= 2 && (session?.topic || "").trim() && (
          <button
            onClick={onStart}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "6px 0",
              background: "#e94560",
              border: "2px solid #c13050",
              color: "#fff",
              fontFamily: "'DungGeunMo', monospace",
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "2px 2px 0 rgba(0,0,0,0.3)",
            }}
          >
            OBJECTION! Start Debate
          </button>
        )}
      </div>

      {/* Paper clip decoration */}
      <div style={{ position: "absolute", top: -6, right: 20, width: 12, height: 16, border: "2px solid #888", borderBottom: "none", borderRadius: "4px 4px 0 0" }} />
    </div>
  );
}

// ============================================================
// Main Cafe Scene
// ============================================================

const MAX_SEATS = 6;
const makeSeats = () => Array.from({ length: MAX_SEATS }, () => ({ agentId: null as string | null }));

const DEBATE_TABLES: DebateTable[] = [
  { tableId: "t1", x: 40, y: 180, seats: makeSeats() },
  { tableId: "t2", x: 0, y: 310, seats: makeSeats() }, // x set dynamically
  { tableId: "t3", x: 0, y: 430, seats: makeSeats() },
];

export function CafeScene({ agents, weather }: { agents: Agent[]; weather: SeoulWeather }) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 400, height: 600 });
  const [tables, setTables] = useState<DebateTable[]>(DEBATE_TABLES);
  const [sessions, setSessions] = useState<Map<string, DebateSession>>(new Map());
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [seatedAgents, setSeatedAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    function updateBounds() {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        setBounds({ width: w, height: h });
        // Dynamically position tables
        setTables((prev) => prev.map((t, i) => {
          if (i === 1) return { ...t, x: w / 2 - 26 };
          if (i === 2) return { ...t, x: w - 100 };
          return t;
        }));
      }
    }
    updateBounds();
    window.addEventListener("resize", updateBounds);
    return () => window.removeEventListener("resize", updateBounds);
  }, []);

  // Check if drop position is near a table
  const findNearTable = useCallback((x: number, y: number): DebateTable | null => {
    for (const t of tables) {
      const dx = x - t.x;
      const dy = y - t.y;
      if (dx > -40 && dx < 100 && dy > -50 && dy < 60) return t;
    }
    return null;
  }, [tables]);

  // Handle agent dropped
  const handleAgentDrop = useCallback((agentId: string, x: number, y: number) => {
    const table = findNearTable(x, y);
    if (table) {
      setTables((prev) => prev.map((t) => {
        if (t.tableId !== table.tableId) return t;
        // Remove from other tables first
        const cleaned = { ...t, seats: t.seats.map((s) => s.agentId === agentId ? { agentId: null } : s) };
        // Find empty seat
        const emptySeatIdx = cleaned.seats.findIndex((s) => s.agentId === null);
        if (emptySeatIdx === -1) return t;
        const newSeats = [...cleaned.seats];
        newSeats[emptySeatIdx] = { agentId };
        return { ...cleaned, seats: newSeats };
      }));
      setSeatedAgents((prev) => new Set(prev).add(agentId));
      setActiveSheet(table.tableId);

      // Init session if needed
      setSessions((prev) => {
        const next = new Map(prev);
        if (!next.has(table.tableId)) {
          next.set(table.tableId, { tableId: table.tableId, agents: [], topic: "", rules: "", active: false });
        }
        return next;
      });
    } else {
      // Dropped away from table: unseat
      setTables((prev) => prev.map((t) => ({
        ...t,
        seats: t.seats.map((s) => s.agentId === agentId ? { agentId: null } : s),
      })));
      setSeatedAgents((prev) => { const n = new Set(prev); n.delete(agentId); return n; });
    }
  }, [findNearTable]);

  const handleRemoveAgent = useCallback((tableId: string, agentId: string) => {
    setTables((prev) => prev.map((t) => {
      if (t.tableId !== tableId) return t;
      return { ...t, seats: t.seats.map((s) => s.agentId === agentId ? { agentId: null } : s) };
    }));
    setSeatedAgents((prev) => { const n = new Set(prev); n.delete(agentId); return n; });
  }, []);

  const handleStartDebate = useCallback(async (tableId: string) => {
    const table = tables.find((t) => t.tableId === tableId);
    const session = sessions.get(tableId);
    if (!table || !session) return;
    const agentIds = table.seats.map((s) => s.agentId).filter(Boolean) as string[];
    if (agentIds.length < 2 || !session.topic.trim()) return;

    // Call API to start actual AI-to-AI debate
    try {
      const res = await fetch("/api/debates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: session.topic,
          rules: session.rules,
          agents: agentIds,
          maxRounds: 5,
        }),
      });
      const data = await res.json();
      if (data.ok && data.debate) {
        // Navigate to debate viewer (read-only, AI-to-AI)
        navigate(`/debate/${data.debate.id}`);
      }
    } catch (e) {
      console.error("Failed to start debate:", e);
    }
  }, [tables, sessions, navigate]);

  // Character initial positions (avoid tables)
  const positions = agents.map((_, i) => ({
    x: 20 + ((i * 70 + 30) % (bounds.width - 60)),
    y: 120 + ((i * 90 + 40) % (bounds.height - 200)),
  }));

  // Get seated position for agent at table (up to 6 seats around the table)
  const getSeatedPos = (agentId: string): { x: number; y: number } | null => {
    for (const t of tables) {
      const seatIdx = t.seats.findIndex((s) => s.agentId === agentId);
      if (seatIdx !== -1) {
        // Seats arranged around the table: left, right, top-left, top-right, bottom-left, bottom-right
        const positions = [
          { x: -16, y: -4 },   // left
          { x: 54, y: -4 },    // right
          { x: 4, y: -30 },    // top-left
          { x: 34, y: -30 },   // top-right
          { x: 4, y: 28 },     // bottom-left
          { x: 34, y: 28 },    // bottom-right
        ];
        const p = positions[seatIdx] || positions[0];
        return { x: t.x + p.x, y: t.y + p.y };
      }
    }
    return null;
  };

  const isNight = !weather.isDay;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100dvh - 52px)",
        overflow: "hidden",
        background: `linear-gradient(180deg, #2a1f14 0%, #3d2b1a 30%, #4a3520 60%, #3d2b1a 100%)`,
        imageRendering: "pixelated",
      }}
    >
      {/* Rain/snow animation keyframes */}
      <style>{`
        @keyframes rainDrop { 0% { transform: translateY(-10px); opacity: 0.7; } 100% { transform: translateY(80px); opacity: 0; } }
        @keyframes snowFall { 0% { transform: translateY(-10px) translateX(0); opacity: 0.8; } 100% { transform: translateY(80px) translateX(10px); opacity: 0; } }
        @keyframes lightning { 0%,95%,100% { opacity: 0; } 96% { opacity: 0.6; } 97% { opacity: 0; } 98% { opacity: 0.3; } }
      `}</style>

      {/* Floor tiles */}
      <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(90deg, transparent, transparent 38px, rgba(0,0,0,0.08) 38px, rgba(0,0,0,0.08) 40px), repeating-linear-gradient(0deg, transparent, transparent 38px, rgba(0,0,0,0.08) 38px, rgba(0,0,0,0.08) 40px)`, pointerEvents: "none" }} />

      {/* Sky/Weather wall */}
      <SkyBackground weather={weather} />

      {/* Window */}
      <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", width: 80, height: 50, border: "3px solid #8B6914", overflow: "hidden" }}>
        {/* Window reflects the actual sky behind */}
        <SkyBackground weather={weather} />
        {/* Window frame cross */}
        <div style={{ position: "absolute", top: 0, left: "50%", width: 2, height: "100%", background: "#8B6914" }} />
        <div style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: 2, background: "#8B6914" }} />
      </div>

      {/* Weather info on wall */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, background: "rgba(0,0,0,0.6)", border: "1px solid #e2b714", padding: "2px 6px", fontFamily: "'DungGeunMo', monospace", fontSize: 9, color: "#e2b714" }}>
        Seoul {weather.temperature}C {weather.description}
      </div>

      {/* Sign */}
      <div style={{ position: "absolute", top: 12, left: 16, background: "#3d2b1a", border: "2px solid #e2b714", padding: "2px 8px", fontFamily: "'DungGeunMo', monospace", fontSize: 10, color: "#e2b714", zIndex: 10 }}>
        AI CAFE
      </div>

      {/* Furniture */}
      <Counter x={bounds.width - 110} y={85} width={100} />
      <Bookshelf x={12} y={80} />
      <Bookshelf x={bounds.width - 52} y={bounds.height - 80} />

      {/* Debate tables with chairs (6 seats each) */}
      {tables.map((t) => (
        <div key={t.tableId}>
          <Table x={t.x} y={t.y} id={t.tableId} />
          {/* Left + Right */}
          <Chair x={t.x - 16} y={t.y + 8} />
          <Chair x={t.x + 56} y={t.y + 8} flip />
          {/* Top row */}
          <Chair x={t.x + 6} y={t.y - 18} />
          <Chair x={t.x + 36} y={t.y - 18} flip />
          {/* Bottom row */}
          <Chair x={t.x + 6} y={t.y + 34} />
          <Chair x={t.x + 36} y={t.y + 34} flip />

          {/* Clickable table area - always visible */}
          <div
            onClick={() => {
              setActiveSheet(activeSheet === t.tableId ? null : t.tableId);
              // Init session if needed
              setSessions((prev) => {
                if (prev.has(t.tableId)) return prev;
                const next = new Map(prev);
                next.set(t.tableId, { tableId: t.tableId, agents: [], topic: "", rules: "", active: false });
                return next;
              });
            }}
            style={{
              position: "absolute",
              left: t.x - 20,
              top: t.y - 34,
              width: 92,
              height: 90,
              border: activeSheet === t.tableId ? "2px solid #e2b714" : t.seats.some((s) => s.agentId) ? "2px dashed #e2b714" : "2px dashed rgba(226,183,20,0.2)",
              cursor: "pointer",
              zIndex: t.y + 20,
              background: activeSheet === t.tableId ? "rgba(226,183,20,0.08)" : "transparent",
            }}
          />
        </div>
      ))}

      {/* Extra furniture */}
      <Plant x={bounds.width - 28} y={80} />
      <Plant x={14} y={bounds.height - 50} big />
      <Plant x={bounds.width / 2 + 60} y={bounds.height - 40} />
      <Lamp x={60} y={140} on={isNight} />
      <Lamp x={bounds.width - 70} y={260} on={isNight} />
      <Lamp x={bounds.width / 2 - 10} y={400} on={isNight} />
      <Painting x={bounds.width / 2 - 45} y={16} color="#2a4a3a" />
      <Painting x={bounds.width / 2 + 25} y={18} color="#4a2a3a" />
      <CatNpc x={bounds.width - 50} y={bounds.height - 55} />

      {/* Ambient light at night */}
      {isNight && <>
        <div style={{ position: "absolute", top: 100, left: 50, width: 120, height: 80, background: "radial-gradient(ellipse, rgba(226,183,20,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 220, left: bounds.width - 80, width: 100, height: 70, background: "radial-gradient(ellipse, rgba(226,183,20,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 360, left: bounds.width / 2 - 20, width: 100, height: 70, background: "radial-gradient(ellipse, rgba(226,183,20,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      </>}

      {/* Characters */}
      {agents.map((agent, i) => {
        const seatedPos = getSeatedPos(agent.id);
        return (
          <PixelCharacter
            key={agent.id}
            id={agent.id}
            name={agent.name}
            color={agent.color}
            status={agent.status}
            initialX={seatedPos?.x ?? positions[i].x}
            initialY={seatedPos?.y ?? positions[i].y}
            bounds={bounds}
            onClick={() => navigate(`/chat/${agent.id}`)}
            onDrop={(x, y) => handleAgentDrop(agent.id, x, y)}
            seated={seatedAgents.has(agent.id)}
          />
        );
      })}

      {/* Order Sheet popup - shows on any table click */}
      {activeSheet && (
        <OrderSheet
          table={tables.find((t) => t.tableId === activeSheet)!}
          agents={agents}
          session={sessions.get(activeSheet) || null}
          onClose={() => setActiveSheet(null)}
          onStart={() => handleStartDebate(activeSheet)}
          onUpdateTopic={(t) => setSessions((prev) => {
            const next = new Map(prev);
            const s = next.get(activeSheet) || { tableId: activeSheet, agents: [], topic: "", rules: "", active: false };
            next.set(activeSheet, { ...s, topic: t });
            return next;
          })}
          onUpdateRules={(r) => setSessions((prev) => {
            const next = new Map(prev);
            const s = next.get(activeSheet) || { tableId: activeSheet, agents: [], topic: "", rules: "", active: false };
            next.set(activeSheet, { ...s, rules: r });
            return next;
          })}
          onRemoveAgent={(id) => handleRemoveAgent(activeSheet, id)}
        />
      )}
    </div>
  );
}
