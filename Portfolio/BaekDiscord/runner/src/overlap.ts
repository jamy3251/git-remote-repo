import fs from "node:fs";
import path from "node:path";
import type { FolderOverlap, SessionInfo } from "./protocol.js";

/**
 * Same-folder warning (devhub-next-20261113.md): two agents writing in one folder, or in a folder
 * and its parent, overwrite each other. Before a session starts, the running sessions that could
 * collide with it are listed so a person can decide.
 */

/** Real path, lower-cased: junctions and letter case must not hide that two paths are one folder. */
export function normalizeFolder(p: string): string {
  let real = path.resolve(p);
  try {
    real = fs.realpathSync.native(real);
  } catch {
    /* gone or unreadable: compare the path as written */
  }
  return real.replace(/[\\/]+$/, "").toLowerCase();
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Sessions that only read (cross-verification) never collide with a writer. */
export function isReadOnlySession(s: Pick<SessionInfo, "preset" | "tags">): boolean {
  return s.preset === "claude-review" || s.preset === "codex-review" || s.tags.includes("review");
}

export function findOverlaps(target: string, sessions: SessionInfo[], cwdRoot: string): FolderOverlap[] {
  const t = normalizeFolder(target);
  const root = normalizeFolder(cwdRoot);
  const out: FolderOverlap[] = [];
  for (const s of sessions) {
    if (s.status !== "running" || isReadOnlySession(s)) continue;
    const c = normalizeFolder(s.cwd);
    let relation: FolderOverlap["relation"] | null = null;
    if (c === t) relation = "same";
    // A session started at the work root sits above everything; say that instead of "parent".
    else if (c === root) relation = "root";
    else if (contains(c, t)) relation = "parent";
    else if (contains(t, c)) relation = "child";
    if (relation) out.push({ id: s.id, name: s.name, cwd: s.cwd, relation });
  }
  return out;
}

const RELATION_TEXT: Record<FolderOverlap["relation"], string> = {
  same: "같은 폴더",
  parent: "상위 폴더",
  child: "하위 폴더",
  root: "작업 폴더 전체",
};

export function describeOverlaps(overlaps: FolderOverlap[]): string {
  return overlaps.map((o) => `${o.name}(${o.id}, ${RELATION_TEXT[o.relation]}: ${o.cwd})`).join(", ");
}
