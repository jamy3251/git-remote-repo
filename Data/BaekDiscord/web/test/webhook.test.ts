import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePullRequestEvent, parsePushEvent, verifySignature, PUSH_COMMIT_LIMIT } from "@/lib/github/webhook";

const secret = "s3cret";
const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifySignature", () => {
  it("accepts a valid signature and rejects tampering", () => {
    const body = JSON.stringify({ a: 1 });
    expect(verifySignature(body, sign(body), secret)).toBe(true);
    expect(verifySignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifySignature(body, sign(body), "other")).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
  });
});

const push = (n: number, over: Record<string, unknown> = {}) => ({
  ref: "refs/heads/main",
  before: "aaa",
  after: "bbb",
  repository: { full_name: "team/repo" },
  commits: Array.from({ length: n }, (_, i) => ({
    id: `sha${i}`,
    message: `feat: 작업 ${i}\n\n본문`,
    timestamp: "2026-09-22T10:00:00+09:00",
    author: { username: i % 2 ? "minsu" : undefined, name: "x", email: "x@y" },
    distinct: true,
  })),
  ...over,
});

describe("parsePushEvent", () => {
  it("maps commits to rows with repo+sha dedup keys and login/no-login split", () => {
    const { events, needsBackfill } = parsePushEvent(push(2));
    expect(needsBackfill).toBe(false);
    expect(events).toHaveLength(2);
    expect(events[0].dedupKey).toBe("team/repo+sha0");
    expect(events[0].githubLogin).toBeNull(); // 이메일 미연결
    expect(events[1].githubLogin).toBe("minsu");
    expect(events[0].payloadJson.title).toBe("feat: 작업 0");
    expect(events[0].type).toBe("commit");
  });

  it("produces identical dedup keys when the same sha is force-pushed again", () => {
    const a = parsePushEvent(push(1, { forced: false })).events[0];
    const b = parsePushEvent(push(1, { forced: true, before: "zzz" })).events[0];
    expect(a.dedupKey).toBe(b.dedupKey);
  });

  it("flags backfill when a push carries more than 20 commits", () => {
    const { events, needsBackfill } = parsePushEvent(push(PUSH_COMMIT_LIMIT + 1));
    expect(needsBackfill).toBe(true);
    const flagged = events.filter((e) => e.needsBackfill);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].payloadJson.compare).toEqual({ before: "aaa", after: "bbb" });
  });

  it("ignores branch deletions and non-distinct commits", () => {
    expect(parsePushEvent(push(3, { deleted: true })).events).toHaveLength(0);
    const p = push(2);
    p.commits[0].distinct = false;
    expect(parsePushEvent(p).events).toHaveLength(1);
  });
});

describe("parsePullRequestEvent", () => {
  const pr = (action: string, merged = false) => ({
    action,
    number: 31,
    repository: { full_name: "team/repo" },
    pull_request: {
      number: 31,
      title: "지도 클러스터링",
      merged,
      merged_at: merged ? "2026-09-22T01:00:00Z" : null,
      created_at: "2026-09-21T01:00:00Z",
      closed_at: "2026-09-22T01:00:00Z",
      html_url: "https://github.com/team/repo/pull/31",
      user: { login: "minsu" },
    },
  });

  it("maps opened / merged / closed", () => {
    expect(parsePullRequestEvent(pr("opened"))?.type).toBe("pr_opened");
    expect(parsePullRequestEvent(pr("closed", true))?.type).toBe("pr_merged");
    expect(parsePullRequestEvent(pr("closed", false))?.type).toBe("pr_closed");
    expect(parsePullRequestEvent(pr("closed", true))?.dedupKey).toBe("team/repo+pr#31+pr_merged");
    expect(parsePullRequestEvent(pr("opened"))?.payloadJson.number).toBe(31);
  });

  it("ignores synchronize / labeled / review_requested", () => {
    for (const a of ["synchronize", "labeled", "review_requested", "edited"]) {
      expect(parsePullRequestEvent(pr(a))).toBeNull();
    }
  });
});
