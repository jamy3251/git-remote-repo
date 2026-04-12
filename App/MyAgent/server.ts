import express from "express";
import { createRequestHandler } from "@react-router/express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { getDb } from "./app/lib/db.server.js";

const app = express();
const server = http.createServer(app);

// WebSocket server on same port
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("[WS] Client connected. Total:", clients.size);

  // Send current agents list on connect
  try {
    const db = getDb();
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all();
    ws.send(JSON.stringify({ type: "agents_list", agents }));
  } catch (e) {
    console.error("[WS] Error sending agents list:", e);
  }

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWsMessage(msg, ws);
    } catch (e) {
      console.error("[WS] Message parse error:", e);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("[WS] Client disconnected. Total:", clients.size);
  });
});

function broadcast(msg: object, exclude?: WebSocket) {
  const data = JSON.stringify(msg);
  clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function handleWsMessage(msg: any, sender: WebSocket) {
  const db = getDb();

  switch (msg.type) {
    case "update_status": {
      db.prepare("UPDATE agents SET status = ?, last_active_at = datetime('now') WHERE id = ?").run(
        msg.status,
        msg.agentId
      );
      broadcast({ type: "agent_status", agentId: msg.agentId, status: msg.status });
      break;
    }
    case "send_message": {
      const result = db
        .prepare(
          "INSERT INTO messages (agent_id, content, role) VALUES (?, ?, ?) RETURNING id, created_at"
        )
        .get(msg.agentId, msg.content, msg.role || "user") as {
        id: number;
        created_at: string;
      };

      db.prepare("UPDATE agents SET last_active_at = datetime('now') WHERE id = ?").run(
        msg.agentId
      );

      const newMsg = {
        id: result.id,
        agent_id: msg.agentId,
        content: msg.content,
        role: msg.role || "user",
        created_at: result.created_at,
      };

      // Broadcast to all clients including sender
      const broadcastMsg = { type: "new_message", agentId: msg.agentId, message: newMsg };
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(broadcastMsg));
        }
      });
      break;
    }
    case "ping": {
      sender.send(JSON.stringify({ type: "pong" }));
      break;
    }
  }
}

// Export broadcast for use in routes
(globalThis as any).__wsBroadcast = broadcast;

// JSON body parser for API routes
app.use(express.json());

// Polling fallback API (for tunnels that don't support WebSocket)
app.get("/api/agents", (_req, res) => {
  const db = getDb();
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all();
  res.json(agents);
});

app.get("/api/messages/:agentId", (req, res) => {
  const db = getDb();
  const messages = db
    .prepare("SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC")
    .all(req.params.agentId);
  res.json(messages);
});

app.post("/api/messages", (req, res) => {
  const db = getDb();
  const { agentId, content, role } = req.body;
  const result = db
    .prepare("INSERT INTO messages (agent_id, content, role) VALUES (?, ?, ?) RETURNING id, created_at")
    .get(agentId, content, role || "user") as { id: number; created_at: string };

  db.prepare("UPDATE agents SET last_active_at = datetime('now'), status = ? WHERE id = ?")
    .run(role === "assistant" ? "done" : "working", agentId);

  const newMsg = { id: result.id, agent_id: agentId, content, role: role || "user", created_at: result.created_at };
  broadcast({ type: "new_message", agentId, message: newMsg });
  broadcast({ type: "agent_status", agentId, status: role === "assistant" ? "done" : "working" });
  res.json(newMsg);
});

// ============================================================
// Chrome Extension Bridge API
// ============================================================

// Allow CORS from extension and AI sites
app.use("/api/extension", (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});

// Extension sends a new message from an AI tab
app.post("/api/extension/message", (req, res) => {
  const db = getDb();
  const { agentId, content, role } = req.body;
  if (!agentId || !content) { res.status(400).json({ error: "missing fields" }); return; }

  // Ensure agent exists (auto-create if new AI detected)
  const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
  if (!agent) {
    const name = agentId.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    db.prepare("INSERT INTO agents (id, name, role, color) VALUES (?, ?, 'AI Assistant', '#888')")
      .run(agentId, name);
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all();
    broadcast({ type: "agents_list", agents });
  }

  // Deduplicate: check if the exact same message already exists (within last 60s)
  const existing = db.prepare(
    "SELECT id FROM messages WHERE agent_id = ? AND content = ? AND role = ? AND created_at > datetime('now', '-60 seconds')"
  ).get(agentId, content, role || "assistant");

  if (existing) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  const result = db.prepare(
    "INSERT INTO messages (agent_id, content, role) VALUES (?, ?, ?) RETURNING id, created_at"
  ).get(agentId, content, role || "assistant") as { id: number; created_at: string };

  db.prepare("UPDATE agents SET last_active_at = datetime('now') WHERE id = ?").run(agentId);

  const newMsg = { id: result.id, agent_id: agentId, content, role: role || "assistant", created_at: result.created_at };
  broadcast({ type: "new_message", agentId, message: newMsg });

  // Auto-relay: if this agent is in an active debate, forward to next agent
  if ((role || "assistant") === "assistant") {
    checkDebateRelay(agentId, content);
  }

  res.json({ ok: true, message: newMsg });
});

// Extension updates agent status
app.post("/api/extension/status", (req, res) => {
  const db = getDb();
  const { agentId, status } = req.body;
  if (!agentId || !status) { res.status(400).json({ error: "missing fields" }); return; }

  db.prepare("UPDATE agents SET status = ?, last_active_at = datetime('now') WHERE id = ?")
    .run(status, agentId);
  broadcast({ type: "agent_status", agentId, status });
  res.json({ ok: true });
});

// Extension syncs full conversation (initial load)
app.post("/api/extension/sync", (req, res) => {
  const db = getDb();
  const { agentId, messages } = req.body;
  if (!agentId || !messages) { res.status(400).json({ error: "missing fields" }); return; }

  // Ensure agent exists
  const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId);
  if (!agent) {
    const name = agentId.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    db.prepare("INSERT INTO agents (id, name, role, color) VALUES (?, ?, 'AI Assistant', '#888')")
      .run(agentId, name);
  }

  let added = 0;
  const insert = db.prepare(
    "INSERT INTO messages (agent_id, content, role) VALUES (?, ?, ?)"
  );

  for (const msg of messages) {
    // Deduplicate
    const existing = db.prepare(
      "SELECT id FROM messages WHERE agent_id = ? AND content = ? AND role = ?"
    ).get(agentId, msg.content, msg.role);
    if (!existing) {
      insert.run(agentId, msg.content, msg.role);
      added++;
    }
  }

  db.prepare("UPDATE agents SET last_active_at = datetime('now'), status = 'idle' WHERE id = ?")
    .run(agentId);

  // Refresh client
  const allMessages = db.prepare("SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC").all(agentId);
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at").all();
  broadcast({ type: "agents_list", agents });

  console.log(`[Extension] Synced ${added} new messages for ${agentId}`);
  res.json({ ok: true, added });
});

// Extension sends a suggestion detected from AI UI
app.post("/api/extension/suggestion", (req, res) => {
  const db = getDb();
  const { agentId, content } = req.body;
  if (!agentId || !content) { res.status(400).json({ error: "missing fields" }); return; }

  // Deduplicate: same suggestion within last 5 minutes
  const existing = db.prepare(
    "SELECT id FROM suggestions WHERE agent_id = ? AND content = ? AND created_at > datetime('now', '-5 minutes')"
  ).get(agentId, content);
  if (existing) { res.json({ ok: true, duplicate: true }); return; }

  const result = db.prepare(
    "INSERT INTO suggestions (agent_id, content) VALUES (?, ?) RETURNING id, created_at"
  ).get(agentId, content) as { id: number; created_at: string };

  const suggestion = { id: result.id, agent_id: agentId, content, status: "pending", created_at: result.created_at };
  broadcast({ type: "new_suggestion", agentId, suggestion });
  console.log(`[Extension] Suggestion from ${agentId}: "${content.slice(0, 50)}..."`);
  res.json({ ok: true, suggestion });
});

// Get pending suggestions for an agent
app.get("/api/suggestions/:agentId", (req, res) => {
  const db = getDb();
  const suggestions = db.prepare(
    "SELECT * FROM suggestions WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 10"
  ).all(req.params.agentId);
  res.json(suggestions);
});

// Update suggestion status (accept/dismiss)
app.post("/api/suggestions/:id/action", (req, res) => {
  const db = getDb();
  const { action } = req.body; // "accepted" | "dismissed"
  db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(action, req.params.id);
  res.json({ ok: true });
});

// ============================================================
// CLI Agent Management (Claude Code, Codex auto-accept)
// ============================================================

// Get/update agent settings
app.get("/api/agent-settings/:agentId", (req, res) => {
  const db = getDb();
  let settings = db.prepare("SELECT * FROM agent_settings WHERE agent_id = ?").get(req.params.agentId);
  if (!settings) {
    const agentType = (req.params.agentId === "claude-code" || req.params.agentId === "codex") ? "cli" : "web";
    db.prepare("INSERT INTO agent_settings (agent_id, agent_type) VALUES (?, ?)").run(req.params.agentId, agentType);
    settings = db.prepare("SELECT * FROM agent_settings WHERE agent_id = ?").get(req.params.agentId);
  }
  res.json(settings);
});

app.post("/api/agent-settings/:agentId", (req, res) => {
  const db = getDb();
  const { agent_type, auto_accept, cli_command } = req.body;

  // Ensure row exists
  db.prepare("INSERT OR IGNORE INTO agent_settings (agent_id) VALUES (?)").run(req.params.agentId);

  if (agent_type !== undefined) {
    db.prepare("UPDATE agent_settings SET agent_type = ? WHERE agent_id = ?").run(agent_type, req.params.agentId);
  }
  if (auto_accept !== undefined) {
    db.prepare("UPDATE agent_settings SET auto_accept = ? WHERE agent_id = ?").run(auto_accept ? 1 : 0, req.params.agentId);
  }
  if (cli_command !== undefined) {
    db.prepare("UPDATE agent_settings SET cli_command = ? WHERE agent_id = ?").run(cli_command, req.params.agentId);
  }

  const settings = db.prepare("SELECT * FROM agent_settings WHERE agent_id = ?").get(req.params.agentId);
  broadcast({ type: "agent_settings_updated", agentId: req.params.agentId, settings });
  res.json(settings);
});

// Extension tab events
app.post("/api/extension/event", (req, res) => {
  const { event, agent, tabId } = req.body;
  console.log(`[Extension] ${event}: ${agent} (tab ${tabId})`);

  if (event === "tab_detected") {
    const db = getDb();
    db.prepare("UPDATE agents SET status = 'idle', last_active_at = datetime('now') WHERE id = ?")
      .run(agent);
    broadcast({ type: "agent_status", agentId: agent, status: "idle" });
  } else if (event === "tab_closed") {
    broadcast({ type: "agent_status", agentId: agent, status: "idle" });
  }

  res.json({ ok: true });
});

// ============================================================
// AI-to-AI Debate System (auto relay)
// ============================================================

// CORS for relay polling from extension
app.use("/api/relay", (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
  next();
});

// Start a debate between agents
app.post("/api/debates", (req, res) => {
  const db = getDb();
  const { topic, rules, agents, maxRounds } = req.body;
  if (!topic || !agents || agents.length < 2) {
    res.status(400).json({ error: "need topic + at least 2 agents" });
    return;
  }

  const result = db.prepare(
    "INSERT INTO debates (topic, rules, agents, max_rounds, current_turn) VALUES (?, ?, ?, ?, ?) RETURNING id"
  ).get(topic, rules || "", JSON.stringify(agents), maxRounds || 5, agents[0]) as { id: number };

  const debate = db.prepare("SELECT * FROM debates WHERE id = ?").get(result.id);

  // Send the opening prompt to the first agent
  const firstAgent = agents[0];
  const otherNames = agents.slice(1).map((id: string) => {
    const a = db.prepare("SELECT name FROM agents WHERE id = ?").get(id) as { name: string } | undefined;
    return a?.name || id;
  }).join(", ");

  const prompt = rules
    ? `[Debate] Topic: "${topic}"\nRules: ${rules}\nYou are debating against: ${otherNames}.\nGive your position.`
    : `[Debate] Topic: "${topic}"\nYou are debating against: ${otherNames}.\nGive your position clearly and concisely.`;

  // Queue the message to the first agent
  db.prepare(
    "INSERT INTO relay_queue (debate_id, source_agent, target_agent, content) VALUES (?, 'system', ?, ?)"
  ).run(result.id, firstAgent, prompt);

  broadcast({ type: "debate_started", debate });
  console.log(`[Debate #${result.id}] Started: "${topic}" between ${agents.join(", ")}`);
  res.json({ ok: true, debate });
});

// Get active debates
app.get("/api/debates", (_req, res) => {
  const db = getDb();
  const debates = db.prepare("SELECT * FROM debates WHERE status = 'active' ORDER BY created_at DESC").all();
  res.json(debates);
});

// Get a specific debate with its messages
app.get("/api/debates/:id", (req, res) => {
  const db = getDb();
  const debate = db.prepare("SELECT * FROM debates WHERE id = ?").get(req.params.id);
  if (!debate) { res.status(404).json({ error: "not found" }); return; }
  // Get messages from all agents in this debate
  const d = debate as any;
  const agentIds = JSON.parse(d.agents) as string[];
  const messages = db.prepare(
    `SELECT * FROM messages WHERE agent_id IN (${agentIds.map(() => "?").join(",")}) AND created_at >= ? ORDER BY created_at ASC`
  ).all(...agentIds, d.created_at);
  res.json({ debate, messages });
});

// Pause/resume/stop a debate
app.post("/api/debates/:id/control", (req, res) => {
  const db = getDb();
  const { action } = req.body; // pause | resume | stop
  if (action === "pause") {
    db.prepare("UPDATE debates SET status = 'paused' WHERE id = ?").run(req.params.id);
  } else if (action === "resume") {
    db.prepare("UPDATE debates SET status = 'active' WHERE id = ?").run(req.params.id);
  } else if (action === "stop") {
    db.prepare("UPDATE debates SET status = 'finished' WHERE id = ?").run(req.params.id);
    // Clear pending relays
    db.prepare("DELETE FROM relay_queue WHERE debate_id = ? AND status = 'pending'").run(req.params.id);
  }
  const debate = db.prepare("SELECT * FROM debates WHERE id = ?").get(req.params.id);
  broadcast({ type: "debate_updated", debate });
  res.json({ ok: true, debate });
});

// Extension polls for pending relay messages
app.get("/api/relay/pending", (_req, res) => {
  const db = getDb();
  const pending = db.prepare(
    "SELECT * FROM relay_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
  ).all();
  res.json(pending);
});

// Extension acknowledges relay delivery
app.post("/api/relay/:id/ack", (req, res) => {
  const db = getDb();
  db.prepare("UPDATE relay_queue SET status = 'sent' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Core relay logic: when an AI responds, forward to the next AI in the debate
function checkDebateRelay(agentId: string, content: string) {
  const db = getDb();

  // Find active debates this agent is in
  const debates = db.prepare(
    "SELECT * FROM debates WHERE status = 'active' AND current_turn = ?"
  ).all(agentId) as any[];

  for (const debate of debates) {
    const agents = JSON.parse(debate.agents) as string[];
    const currentIdx = agents.indexOf(agentId);
    if (currentIdx === -1) continue;

    // Move to next turn
    const nextIdx = (currentIdx + 1) % agents.length;
    const nextAgent = agents[nextIdx];
    const newRound = nextIdx === 0 ? debate.round + 1 : debate.round;

    // Check if max rounds reached
    if (newRound > debate.max_rounds) {
      db.prepare("UPDATE debates SET status = 'finished', round = ? WHERE id = ?")
        .run(newRound, debate.id);
      broadcast({ type: "debate_updated", debate: { ...debate, status: "finished", round: newRound } });
      console.log(`[Debate #${debate.id}] Finished after ${debate.max_rounds} rounds`);
      continue;
    }

    // Update debate state
    db.prepare("UPDATE debates SET current_turn = ?, round = ? WHERE id = ?")
      .run(nextAgent, newRound, debate.id);

    // Get the responding agent's name
    const responder = db.prepare("SELECT name FROM agents WHERE id = ?").get(agentId) as { name: string } | undefined;
    const responderName = responder?.name || agentId;

    // Format the relay message
    const relayContent = `[Debate - Round ${newRound}/${debate.max_rounds}] ${responderName} said:\n"${content}"\n\nRespond to their argument.`;

    // Queue for delivery via extension
    db.prepare(
      "INSERT INTO relay_queue (debate_id, source_agent, target_agent, content) VALUES (?, ?, ?, ?)"
    ).run(debate.id, agentId, nextAgent, relayContent);

    broadcast({
      type: "debate_relay",
      debateId: debate.id,
      from: agentId,
      to: nextAgent,
      round: newRound,
    });

    console.log(`[Debate #${debate.id}] Round ${newRound}: ${agentId} → ${nextAgent}`);
  }
}

// Serve static files
app.use(express.static("build/client"));

// React Router handler
app.all(
  "/{*path}",
  createRequestHandler({
    build: () => import("./build/server/index.js"),
  })
);

async function startTunnel(port: number) {
  // Try cloudflared first (best WebSocket support), fallback to localtunnel
  const { execSync, spawn } = await import("child_process");

  // Check if cloudflared is available
  try {
    execSync("cloudflared --version", { stdio: "ignore" });
    console.log("\n  [Tunnel] Starting cloudflared...");
    const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    cf.stderr.on("data", (data: Buffer) => {
      const line = data.toString();
      const match = line.match(/https:\/\/[^\s]+\.trycloudflare\.com/);
      if (match) {
        console.log(`  Phone:   ${match[0]}`);
        console.log(`  (open this URL on your phone)\n`);
      }
    });

    cf.on("error", () => {
      console.log("  [Tunnel] cloudflared failed, trying localtunnel...");
      fallbackToLocaltunnel(port);
    });

    return;
  } catch {
    // cloudflared not installed
  }

  await fallbackToLocaltunnel(port);
}

async function fallbackToLocaltunnel(port: number) {
  try {
    const localtunnel = (await import("localtunnel")).default;
    const tunnel = await localtunnel({ port });
    console.log(`\n  Phone:   ${tunnel.url}`);
    console.log(`  (open this URL on your phone)`);
    console.log(`  Note: first visit shows a confirmation page, click "Click to Continue"\n`);

    tunnel.on("close", () => console.log("[Tunnel] Closed."));
    tunnel.on("error", (err: Error) => console.error("[Tunnel] Error:", err.message));
  } catch (e: any) {
    console.error(`\n  [Tunnel] Failed: ${e.message}`);
    console.log(`  Install cloudflared for best experience:`);
    console.log(`  winget install Cloudflare.cloudflared\n`);
  }
}

const PORT = Number(process.env.PORT) || 3456;
server.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n  MyAgent running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);

  // Show network IPs for LAN access
  const os = await import("os");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  LAN:     http://${net.address}:${PORT}`);
      }
    }
  }

  // Open tunnel for phone access (PC = ethernet only, phone = mobile data)
  if (process.env.NO_TUNNEL !== "1") {
    await startTunnel(PORT);
  }

  console.log();
});
