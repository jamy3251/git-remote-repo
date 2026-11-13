import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Last time a Claude Code session wrote to its transcript, per working folder. */
export interface ClaudeActivity {
  cwd: string;
  lastAt: number;
}

const CWD_RE = /"cwd":"((?:[^"\\]|\\.)*)"/;
const HEAD_BYTES = 64 * 1024;
const CACHE_MS = 5_000;

const cwdByFile = new Map<string, string | null>();
let cache: { at: number; dir: string; value: ClaudeActivity[] } | null = null;

function firstCwd(file: string): string | null {
  if (cwdByFile.has(file)) return cwdByFile.get(file)!;
  let cwd: string | null = null;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
      const m = buf.toString("utf8", 0, n).match(CWD_RE);
      if (m) cwd = JSON.parse(`"${m[1]}"`) as string;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    cwd = null;
  }
  // Transcripts without a cwd yet (just created) are retried next time.
  if (cwd) cwdByFile.set(file, cwd);
  return cwd;
}

/**
 * Claude Code keeps one folder per working directory under ~/.claude/projects with a .jsonl
 * transcript per conversation, appended on every turn. The newest transcript's mtime is when
 * Claude last did something in that folder — including sessions started outside the runner.
 */
export function claudeActivity(projectsDir = path.join(os.homedir(), ".claude", "projects")): ClaudeActivity[] {
  const now = Date.now();
  if (cache && cache.dir === projectsDir && now - cache.at < CACHE_MS) return cache.value;
  const byCwd = new Map<string, ClaudeActivity>();
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    dirs = [];
  }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    let newest: { file: string; mtime: number } | null = null;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const file = path.join(dir, f);
        const mtime = fs.statSync(file).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file, mtime };
      }
    } catch {
      continue;
    }
    if (!newest) continue;
    const cwd = firstCwd(newest.file);
    if (!cwd) continue;
    const key = path.resolve(cwd).toLowerCase();
    const prev = byCwd.get(key);
    if (!prev || newest.mtime > prev.lastAt) byCwd.set(key, { cwd: path.resolve(cwd), lastAt: newest.mtime });
  }
  const value = [...byCwd.values()].sort((a, b) => b.lastAt - a.lastAt);
  cache = { at: now, dir: projectsDir, value };
  return value;
}

/** Every Claude Code conversation (one transcript each) with its working folder and last write time. */
export function claudeTranscripts(projectsDir = path.join(os.homedir(), ".claude", "projects")): Array<{ cwd: string; at: number }> {
  const out: Array<{ cwd: string; at: number }> = [];
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    const files: Array<{ file: string; at: number }> = [];
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".jsonl")) files.push({ file: path.join(dir, f), at: fs.statSync(path.join(dir, f)).mtimeMs });
    } catch {
      continue;
    }
    // All transcripts in one project folder share its working directory; read it once.
    files.sort((a, b) => b.at - a.at);
    let cwd: string | null = null;
    for (const f of files) if ((cwd = firstCwd(f.file))) break;
    if (!cwd) continue;
    for (const f of files) out.push({ cwd: path.resolve(cwd), at: f.at });
  }
  return out;
}
