import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify GitHub's X-Hub-Signature-256 header against the raw body. */
export function verifySignature(rawBody: string | Buffer, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ParsedEvent {
  type: "commit" | "pr_opened" | "pr_merged" | "pr_closed";
  githubLogin: string | null;
  repo: string;
  tsAuthored: Date | null;
  dedupKey: string;
  payloadJson: Record<string, unknown>;
  needsBackfill: boolean;
}

interface PushCommit {
  id: string;
  message?: string;
  timestamp?: string;
  author?: { username?: string; name?: string; email?: string };
  distinct?: boolean;
}

export interface PushPayload {
  ref?: string;
  before?: string;
  after?: string;
  forced?: boolean;
  deleted?: boolean;
  repository?: { full_name?: string };
  commits?: PushCommit[];
  head_commit?: PushCommit | null;
}

export const PUSH_COMMIT_LIMIT = 20;

export function commitDedupKey(repo: string, sha: string): string {
  return `${repo}+${sha}`;
}

export function prDedupKey(repo: string, number: number, type: string): string {
  return `${repo}+pr#${number}+${type}`;
}

/** Push payload → commit rows. Same sha after a force-push produces the same dedup key (ignored on insert). */
export function parsePushEvent(payload: PushPayload): { events: ParsedEvent[]; needsBackfill: boolean } {
  const repo = payload.repository?.full_name;
  if (!repo || payload.deleted) return { events: [], needsBackfill: false };
  const commits = payload.commits ?? [];
  const needsBackfill = commits.length > PUSH_COMMIT_LIMIT;
  const events: ParsedEvent[] = commits
    .filter((c) => c.distinct !== false)
    .map((c) => ({
      type: "commit" as const,
      githubLogin: c.author?.username?.trim() || null,
      repo,
      tsAuthored: c.timestamp ? new Date(c.timestamp) : null,
      dedupKey: commitDedupKey(repo, c.id),
      payloadJson: {
        sha: c.id,
        title: (c.message ?? "").split("\n")[0].slice(0, 200),
        ref: payload.ref ?? null,
        authorName: c.author?.name ?? null,
      },
      needsBackfill: false,
    }));
  if (needsBackfill && events.length) {
    // Flag the last row so the cron backfill knows to fetch the compare range before..after.
    const last = events[events.length - 1];
    last.needsBackfill = true;
    last.payloadJson = { ...last.payloadJson, compare: { before: payload.before ?? null, after: payload.after ?? null } };
  }
  return { events, needsBackfill };
}

export interface PullRequestPayload {
  action?: string;
  number?: number;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    title?: string;
    merged?: boolean;
    merged_at?: string | null;
    created_at?: string;
    closed_at?: string | null;
    html_url?: string;
    user?: { login?: string };
    merged_by?: { login?: string } | null;
  };
}

/** pull_request payload → at most one row. synchronize/labeled/etc are ignored. */
export function parsePullRequestEvent(payload: PullRequestPayload): ParsedEvent | null {
  const repo = payload.repository?.full_name;
  const pr = payload.pull_request;
  const number = pr?.number ?? payload.number;
  if (!repo || !pr || number === undefined) return null;
  let type: ParsedEvent["type"];
  let ts: string | null | undefined;
  switch (payload.action) {
    case "opened":
      type = "pr_opened";
      ts = pr.created_at;
      break;
    case "closed":
      type = pr.merged ? "pr_merged" : "pr_closed";
      ts = pr.merged ? pr.merged_at : pr.closed_at;
      break;
    default:
      return null;
  }
  return {
    type,
    githubLogin: pr.user?.login ?? null,
    repo,
    tsAuthored: ts ? new Date(ts) : null,
    dedupKey: prDedupKey(repo, number, type),
    payloadJson: { number, title: pr.title ?? "", url: pr.html_url ?? null, mergedBy: pr.merged_by?.login ?? null },
    needsBackfill: false,
  };
}
