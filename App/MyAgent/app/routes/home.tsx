import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CafeScene } from "~/components/CafeScene";
import { connectWs, subscribeWs } from "~/lib/ws.client";
import type { Agent } from "~/lib/db.server";
import type { SeoulWeather } from "~/lib/weather.server";
import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "MyAgent Control Tower" },
    { name: "description", content: "AI Agent Dashboard - Ace Attorney Style" },
  ];
}

export async function loader() {
  const { getDb } = await import("~/lib/db.server");
  const { getSeoulWeather } = await import("~/lib/weather.server");
  const db = getDb();
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all() as Agent[];
  const weather = await getSeoulWeather();
  return { agents, weather };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [agents, setAgents] = useState<Agent[]>(loaderData.agents);
  const weather = loaderData.weather as SeoulWeather;

  useEffect(() => {
    connectWs();

    const unsub = subscribeWs((msg) => {
      if (msg.type === "agents_list") {
        setAgents(msg.agents);
      }
      if (msg.type === "agent_status") {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === msg.agentId ? { ...a, status: msg.status } : a
          )
        );
      }
    });

    return () => {
      unsub();
    };
  }, []);

  const workingCount = agents.filter((a) => a.status === "working").length;

  return (
    <div className="scanlines" style={{ height: "100dvh", overflow: "hidden" }}>
      {/* Header */}
      <header
        className="pixel-card m-0 px-3 py-2 flex items-center justify-between"
        style={{
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
          height: 52,
          zIndex: 1000,
          position: "relative",
        }}
      >
        <div className="flex items-center gap-3">
          <h1
            className="text-base crt-glow"
            style={{ color: "var(--accent-gold)" }}
          >
            AI CAFE
          </h1>
          {workingCount > 0 && (
            <span
              className="text-xs px-2 py-0.5"
              style={{
                background: "rgba(226,183,20,0.2)",
                border: "1px solid var(--accent-gold)",
                color: "var(--accent-gold)",
              }}
            >
              {workingCount} working
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            to="/agents/new"
            className="pixel-btn text-xs no-underline py-1 px-2"
          >
            +
          </Link>
          <Link
            to="/settings"
            className="pixel-btn text-xs no-underline py-1 px-2"
          >
            Set
          </Link>
        </div>
      </header>

      {/* Cafe Scene */}
      <CafeScene agents={agents} weather={weather} />
    </div>
  );
}
