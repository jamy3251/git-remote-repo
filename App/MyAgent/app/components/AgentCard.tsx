import { Link } from "react-router";
import type { Agent } from "~/lib/db.server";

const STATUS_LABELS: Record<string, string> = {
  idle: "Standby",
  working: "Working...",
  done: "Complete",
  error: "Error!",
};

const STATUS_ICONS: Record<string, string> = {
  idle: "...",
  working: ">>>",
  done: "OK!",
  error: "ERR",
};

const AGENT_EMOJIS: Record<string, string> = {
  claude: "C",
  chatgpt: "G",
  gemini: "Ge",
  perplexity: "P",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr + "Z").getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      to={`/chat/${agent.id}`}
      className="pixel-card block p-4 mb-3 no-underline text-inherit hover:border-white transition-colors"
    >
      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div
          className="agent-avatar"
          style={{ borderColor: agent.color, color: agent.color }}
        >
          {AGENT_EMOJIS[agent.id] || agent.name[0]}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg" style={{ color: agent.color }}>
              {agent.name}
            </span>
            <span className={`status-dot status-${agent.status}`} />
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {agent.role}
          </div>
        </div>

        {/* Status */}
        <div className="text-right">
          <div
            className="text-sm font-bold"
            style={{
              color:
                agent.status === "working"
                  ? "var(--accent-gold)"
                  : agent.status === "error"
                    ? "var(--accent-red)"
                    : agent.status === "done"
                      ? "#4ade80"
                      : "var(--text-muted)",
            }}
          >
            {STATUS_ICONS[agent.status]}
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {timeAgo(agent.last_active_at)}
          </div>
        </div>
      </div>
    </Link>
  );
}
