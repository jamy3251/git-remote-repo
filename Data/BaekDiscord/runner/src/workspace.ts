import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { GitFileChange, GitSummary } from "./protocol.js";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  return stdout;
}

const cache = new Map<string, { at: number; value: GitSummary | null }>();

/**
 * Snapshot of what changed in a session's working folder: branch, changed files with +/- counts,
 * and recent commits. Cached for a short time so the dashboard can poll cheaply.
 */
export async function gitSummary(cwd: string, maxAgeMs = 15_000): Promise<GitSummary | null> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  let value: GitSummary | null = null;
  try {
    const repoRoot = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const branch = (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    let ahead = 0;
    let behind = 0;
    try {
      const ab = (await git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])).trim();
      const [b, a] = ab.split(/\s+/).map((n) => Number(n) || 0);
      ahead = a;
      behind = b;
    } catch {
      /* no upstream */
    }
    const status = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
    const entries = status.split("\0").filter(Boolean);
    const changed = new Map<string, GitFileChange>();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const code = e.slice(0, 2);
      let path = e.slice(3);
      if (code[0] === "R" || code[0] === "C") {
        // rename entries carry the original path in the next NUL field
        i += 1;
      }
      path = path.replace(/\\/g, "/");
      changed.set(path, { path, status: code.trim() || "?", insertions: 0, deletions: 0 });
    }
    const numstat = await git(cwd, ["diff", "--numstat", "HEAD", "--", "."]).catch(() => "");
    let insertions = 0;
    let deletions = 0;
    for (const line of numstat.split("\n")) {
      const [ins, del, ...rest] = line.split("\t");
      const path = rest.join("\t").replace(/\\/g, "/");
      if (!path) continue;
      const i = ins === "-" ? 0 : Number(ins) || 0;
      const d = del === "-" ? 0 : Number(del) || 0;
      insertions += i;
      deletions += d;
      const f = changed.get(path) ?? { path, status: "M", insertions: 0, deletions: 0 };
      f.insertions = i;
      f.deletions = d;
      changed.set(path, f);
    }
    const log = await git(cwd, ["log", "-5", "--format=%h%x1f%s%x1f%cr", "--", "."]).catch(() => "");
    const recentCommits = log
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [sha, subject, when] = l.split("\x1f");
        return { sha, subject: (subject ?? "").slice(0, 100), when: when ?? "" };
      });
    value = {
      repoRoot,
      branch,
      ahead,
      behind,
      changed: [...changed.values()].sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions)).slice(0, 60),
      insertions,
      deletions,
      recentCommits,
      checkedAt: Date.now(),
    };
  } catch {
    value = null;
  }
  cache.set(cwd, { at: Date.now(), value });
  return value;
}

/**
 * Every uncommitted change under `cwd` (no cap), synchronously. Used to snapshot a folder right
 * before a session spawns, so the work log can attribute only that session's own changes even
 * when the session finishes within milliseconds.
 */
export function gitChangesSync(cwd: string): GitFileChange[] | null {
  const opts = { cwd, windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" as const, stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"] };
  try {
    const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], opts);
    const changed = new Map<string, GitFileChange>();
    const entries = status.split("\0").filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const code = e.slice(0, 2);
      if (code[0] === "R" || code[0] === "C") i += 1;
      const p = e.slice(3).replace(/\\/g, "/");
      changed.set(p, { path: p, status: code.trim() || "?", insertions: 0, deletions: 0 });
    }
    let numstat = "";
    try {
      numstat = execFileSync("git", ["diff", "--numstat", "HEAD", "--", "."], opts);
    } catch {
      numstat = "";
    }
    for (const line of numstat.split("\n")) {
      const [ins, del, ...rest] = line.split("\t");
      const p = rest.join("\t").replace(/\\/g, "/");
      if (!p) continue;
      const f = changed.get(p) ?? { path: p, status: "M", insertions: 0, deletions: 0 };
      f.insertions = ins === "-" ? 0 : Number(ins) || 0;
      f.deletions = del === "-" ? 0 : Number(del) || 0;
      changed.set(p, f);
    }
    return [...changed.values()];
  } catch {
    return null;
  }
}
