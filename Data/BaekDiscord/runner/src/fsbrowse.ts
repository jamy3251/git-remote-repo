import fs from "node:fs";
import path from "node:path";
import type { FsEntry, FsListing, LiveFolder } from "./protocol.js";
import type { ClaudeActivity } from "./cliactivity.js";

/** What is running where, to annotate the listing. */
export interface FolderContext {
  /** cwd of each runner session that is still running. */
  running: string[];
  claude: ClaudeActivity[];
  now?: number;
}

/** Claude activity newer than this counts as "live" for the quick list. */
export const LIVE_MS = 30 * 60_000;

/** Files/folders whose presence marks a folder as a project of some kind. */
const MARKERS: Array<[marker: string, names: string[]]> = [
  ["git", [".git"]],
  ["claude", ["CLAUDE.md", ".claude"]],
  ["node", ["package.json"]],
  ["python", ["pyproject.toml", "requirements.txt", "setup.py"]],
  ["flutter", ["pubspec.yaml"]],
  ["unity", ["ProjectSettings"]],
  ["rust", ["Cargo.toml"]],
  ["go", ["go.mod"]],
  ["java", ["build.gradle", "build.gradle.kts", "pom.xml"]],
];

export const SKIP = new Set(["node_modules", "$RECYCLE.BIN", "System Volume Information", "__pycache__"]);
const MAX_ENTRIES = 300;

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function markersOf(dir: string): string[] {
  const found: string[] = [];
  for (const [marker, names] of MARKERS) {
    if (names.some((n) => fs.existsSync(path.join(dir, n)))) found.push(marker);
  }
  return found;
}

/**
 * Resolve a user-supplied folder (absolute, or relative to the root) and refuse anything that
 * escapes the runner root — including via symlinks/junctions.
 */
export function resolveInRoot(root: string, input?: string | null): string {
  const realRoot = fs.realpathSync(root);
  const raw = typeof input === "string" && input.trim() ? input.trim() : realRoot;
  const target = path.resolve(realRoot, raw);
  if (!inside(realRoot, target)) throw new Error(`루트(${realRoot}) 밖의 경로는 열 수 없습니다`);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`폴더가 없습니다: ${target}`);
  const real = fs.realpathSync(target);
  if (!inside(realRoot, real)) throw new Error(`루트(${realRoot}) 밖을 가리키는 링크입니다`);
  return target;
}

const norm = (p: string) => path.resolve(p).toLowerCase();

function activityUnder(dir: string, ctx: FolderContext): { running: number; claudeAt: number | null } {
  const d = norm(dir);
  const under = (p: string) => {
    const n = norm(p);
    return n === d || n.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
  };
  let claudeAt: number | null = null;
  for (const a of ctx.claude) if (under(a.cwd) && (claudeAt === null || a.lastAt > claudeAt)) claudeAt = a.lastAt;
  return { running: ctx.running.filter(under).length, claudeAt };
}

function liveFolders(root: string, ctx: FolderContext): LiveFolder[] {
  const now = ctx.now ?? Date.now();
  const byPath = new Map<string, LiveFolder>();
  const add = (p: string) => {
    if (!inside(root, path.resolve(p)) || !fs.existsSync(p)) return;
    const key = norm(p);
    if (!byPath.has(key)) byPath.set(key, { path: path.resolve(p), running: 0, claudeAt: null });
  };
  for (const p of ctx.running) add(p);
  for (const a of ctx.claude) if (now - a.lastAt < LIVE_MS) add(a.cwd);
  for (const [key, lf] of byPath) {
    lf.running = ctx.running.filter((p) => norm(p) === key).length;
    lf.claudeAt = ctx.claude.find((a) => norm(a.cwd) === key)?.lastAt ?? null;
  }
  return [...byPath.values()].sort((a, b) => b.running - a.running || (b.claudeAt ?? 0) - (a.claudeAt ?? 0));
}

/** List child folders of `input` (inside `root`) with project markers, for the folder picker. */
export function listFolder(root: string, input?: string | null, ctx: FolderContext = { running: [], claude: [] }): FsListing {
  const realRoot = fs.realpathSync(root);
  const dir = resolveInRoot(realRoot, input);
  const dirents = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith(".") && !SKIP.has(d.name));
  const truncated = dirents.length > MAX_ENTRIES;
  const entries: FsEntry[] = [];
  for (const d of dirents.slice(0, MAX_ENTRIES)) {
    const full = path.join(dir, d.name);
    let modifiedAt = 0;
    try {
      modifiedAt = fs.statSync(full).mtimeMs;
    } catch {
      continue; // permission denied or vanished
    }
    entries.push({ name: d.name, path: full, markers: markersOf(full), modifiedAt, ...activityUnder(full, ctx) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "ko", { sensitivity: "base", numeric: true }));

  const crumbs: FsListing["crumbs"] = [{ name: path.basename(realRoot) || realRoot, path: realRoot }];
  const rel = path.relative(realRoot, dir);
  if (rel) {
    let acc = realRoot;
    for (const part of rel.split(path.sep)) {
      acc = path.join(acc, part);
      crumbs.push({ name: part, path: acc });
    }
  }
  return {
    path: dir,
    parent: rel ? path.dirname(dir) : null,
    root: realRoot,
    crumbs,
    markers: markersOf(dir),
    entries,
    truncated,
    live: liveFolders(realRoot, ctx),
  };
}
