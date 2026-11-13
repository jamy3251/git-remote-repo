import fs from "node:fs";
import path from "node:path";
import type { GitFileChange, GitSummary, WorkLogEntry } from "./protocol.js";

const MAX_ENTRIES = 500;

/**
 * Finished sessions, newest last, persisted as JSON lines so the log survives runner restarts.
 * Small enough to keep fully in memory; rewritten in place when an entry changes (summary).
 */
export class WorkLog {
  private entries: WorkLogEntry[] = [];

  constructor(private file: string) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          this.entries.push(JSON.parse(line) as WorkLogEntry);
        } catch {
          /* skip a torn line */
        }
      }
      this.entries = this.entries.slice(-MAX_ENTRIES);
    } catch {
      this.entries = [];
    }
  }

  list(limit = 100): WorkLogEntry[] {
    return this.entries.slice(-Math.max(1, Math.min(MAX_ENTRIES, limit))).reverse();
  }

  get(id: string): WorkLogEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  add(entry: WorkLogEntry): void {
    this.entries = [...this.entries.filter((e) => e.id !== entry.id), entry].slice(-MAX_ENTRIES);
    if (this.entries.length === MAX_ENTRIES) this.rewrite();
    else this.append(entry);
  }

  update(id: string, patch: Partial<WorkLogEntry>): WorkLogEntry | undefined {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return undefined;
    this.entries[i] = { ...this.entries[i], ...patch, id };
    this.rewrite();
    return this.entries[i];
  }

  private append(entry: WorkLogEntry): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }

  private rewrite(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    fs.renameSync(tmp, this.file);
  }
}

/**
 * What one session changed: the folder's uncommitted diff at the end minus what was already
 * uncommitted when it started. Files whose numbers did not move are left out.
 */
export function gitDelta(before: GitFileChange[] | null, after: GitSummary): NonNullable<WorkLogEntry["git"]> {
  const base = new Map((before ?? []).map((f) => [f.path, f]));
  let insertions = 0;
  let deletions = 0;
  const files: string[] = [];
  for (const f of after.changed) {
    const b = base.get(f.path);
    const ins = Math.max(0, f.insertions - (b?.insertions ?? 0));
    const del = Math.max(0, f.deletions - (b?.deletions ?? 0));
    if (b && ins === 0 && del === 0 && b.status === f.status) continue;
    insertions += ins;
    deletions += del;
    files.push(f.path);
  }
  return { branch: after.branch, insertions, deletions, files: files.slice(0, 30) };
}
