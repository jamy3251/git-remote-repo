import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/agents.new";

const PRESET_COLORS = [
  "#7C3AED", "#10A37F", "#4285F4", "#20B2AA",
  "#E94560", "#E2B714", "#FF6B6B", "#48BB78",
];

export function meta() {
  return [{ title: "Add Agent - MyAgent" }];
}

export async function action({ request }: Route.ActionArgs) {
  const { getDb } = await import("~/lib/db.server");
  const db = getDb();
  const formData = await request.formData();

  const id = (formData.get("name") as string)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `agent-${Date.now()}`;

  const name = formData.get("name") as string;
  const role = formData.get("role") as string;
  const color = formData.get("color") as string;

  db.prepare(
    "INSERT OR IGNORE INTO agents (id, name, role, color) VALUES (?, ?, ?, ?)"
  ).run(id, name, role || "", color || "#7C3AED");

  // Broadcast via WebSocket
  const broadcast = (globalThis as any).__wsBroadcast;
  if (broadcast) {
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all();
    broadcast({ type: "agents_list", agents });
  }

  return { success: true, agentId: id };
}

export default function NewAgent({ actionData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [color, setColor] = useState(PRESET_COLORS[0]);

  if (actionData?.success) {
    navigate("/");
  }

  return (
    <div className="courtroom-bg scanlines min-h-dvh">
      <header
        className="pixel-card m-0 p-4 flex items-center gap-3"
        style={{ borderLeft: "none", borderRight: "none", borderTop: "none" }}
      >
        <Link to="/" className="pixel-btn text-xs py-1 px-3 no-underline">
          Back
        </Link>
        <h1 className="text-lg crt-glow" style={{ color: "var(--accent-gold)" }}>
          New Agent
        </h1>
      </header>

      <form method="post" className="p-4 space-y-4">
        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--accent-gold)" }}>
            Agent Name
          </label>
          <input
            name="name"
            required
            className="pixel-input"
            placeholder="e.g. DeepSeek, Copilot..."
          />
        </div>

        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--accent-gold)" }}>
            Role
          </label>
          <input
            name="role"
            className="pixel-input"
            placeholder="e.g. Code Expert, Research..."
          />
        </div>

        <div>
          <label className="block text-sm mb-2" style={{ color: "var(--accent-gold)" }}>
            Color
          </label>
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-10 h-10 cursor-pointer"
                style={{
                  background: c,
                  border: color === c ? "3px solid white" : "2px solid transparent",
                }}
              />
            ))}
          </div>
          <input type="hidden" name="color" value={color} />
        </div>

        {/* Preview */}
        <div className="pixel-card p-4">
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Preview
          </div>
          <div className="flex items-center gap-3">
            <div
              className="agent-avatar"
              style={{ borderColor: color, color: color }}
            >
              ?
            </div>
            <div>
              <div style={{ color }}>New Agent</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Ready to serve
              </div>
            </div>
          </div>
        </div>

        <button type="submit" className="pixel-btn w-full py-3 text-base">
          Create Agent
        </button>
      </form>
    </div>
  );
}
