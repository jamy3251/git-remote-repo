import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "myagent.db");

let db: Database.Database;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initDb();
  }
  return db;
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT DEFAULT '',
      color TEXT DEFAULT '#7C3AED',
      avatar TEXT DEFAULT 'default',
      status TEXT DEFAULT 'idle',
      last_active_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      title TEXT DEFAULT '',
      started_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      session_id INTEGER REFERENCES sessions(id),
      content TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_settings (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      agent_type TEXT DEFAULT 'web',
      auto_accept INTEGER DEFAULT 0,
      cli_command TEXT DEFAULT '',
      cli_pid INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS debates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      rules TEXT DEFAULT '',
      agents TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      current_turn TEXT DEFAULT '',
      round INTEGER DEFAULT 0,
      max_rounds INTEGER DEFAULT 5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS relay_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debate_id INTEGER REFERENCES debates(id),
      source_agent TEXT NOT NULL,
      target_agent TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed default agents if none exist
  const count = db.prepare("SELECT COUNT(*) as c FROM agents").get() as { c: number };
  if (count.c === 0) {
    const insert = db.prepare(
      "INSERT INTO agents (id, name, role, color, avatar) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run("claude", "Claude", "Code Expert", "#7C3AED", "claude");
    insert.run("chatgpt", "ChatGPT", "General Assistant", "#E94560", "chatgpt");
    insert.run("gemini", "Gemini", "Research", "#4285F4", "gemini");
    insert.run("perplexity", "Perplexity", "Search & Answer", "#20B2AA", "perplexity");
  }

  // Migration: update ChatGPT color to red
  db.prepare("UPDATE agents SET color = '#E94560' WHERE id = 'chatgpt' AND color = '#10A37F'").run();

  // Migration: seed agent_settings for existing agents
  const agentsWithoutSettings = db.prepare(
    "SELECT id FROM agents WHERE id NOT IN (SELECT agent_id FROM agent_settings)"
  ).all() as { id: string }[];
  for (const a of agentsWithoutSettings) {
    const agentType = (a.id === "claude-code" || a.id === "codex") ? "cli" : "web";
    db.prepare("INSERT OR IGNORE INTO agent_settings (agent_id, agent_type) VALUES (?, ?)").run(a.id, agentType);
  }
}

export { getDb };

export type Agent = {
  id: string;
  name: string;
  role: string;
  color: string;
  avatar: string;
  status: string;
  last_active_at: string | null;
  created_at: string;
};

export type Message = {
  id: number;
  agent_id: string;
  session_id: number | null;
  content: string;
  role: string;
  created_at: string;
};

export type Suggestion = {
  id: number;
  agent_id: string;
  content: string;
  status: string; // pending | accepted | dismissed
  created_at: string;
};

export type AgentSettings = {
  agent_id: string;
  agent_type: string; // web | cli
  auto_accept: number; // 0 | 1
  cli_command: string;
  cli_pid: number;
};

export type Debate = {
  id: number;
  topic: string;
  rules: string;
  agents: string; // JSON array of agent IDs
  status: string; // active | paused | finished
  current_turn: string; // agent ID whose turn it is
  round: number;
  max_rounds: number;
  created_at: string;
};
