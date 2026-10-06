import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CrossReview, WorkLogEntry } from "../src/protocol.js";
import { REVIEW_MARKER, buildReviewPrompt, collectDiff, fixPrompt, parseReview, pickReviewer } from "../src/crossreview.js";

const both = { codex: true, claude: true };

function entry(over: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: "w1",
    name: "login-fix",
    preset: "claude-print",
    cwd: "D:\\Projects\\App",
    goal: "로그인 테스트 통과",
    prompt: "로그인 버그 고쳐줘",
    startedAt: 1,
    endedAt: 2,
    status: "exited",
    exitCode: 0,
    bytes: 1,
    tail: ["done"],
    git: { branch: "main", insertions: 3, deletions: 1, files: ["src/auth.ts"] },
    summary: "정상 종료",
    summarySource: "heuristic",
    ...over,
  };
}

describe("pickReviewer", () => {
  it("picks the other AI, falls back when it is missing, honors an explicit choice", () => {
    expect(pickReviewer("claude-print", "auto", both)).toBe("codex");
    expect(pickReviewer("codex-exec", undefined, both)).toBe("claude");
    expect(pickReviewer("shell", "auto", both)).toBe("codex");
    expect(pickReviewer("claude", "auto", { codex: false, claude: true })).toBe("claude");
    expect(pickReviewer("claude", "codex", { codex: false, claude: true })).toBeNull();
    expect(pickReviewer("claude", "auto", { codex: false, claude: false })).toBeNull();
  });
});

describe("parseReview", () => {
  const prompt = buildReviewPrompt(entry(), "diff --git a/x b/x", "review", "codex");

  it("ignores the prompt's own echo and reads the reviewer's final JSON", () => {
    const answer = `${REVIEW_MARKER}\n{"verdict":"fail","summary":"세션 만료 처리 누락","findings":[{"severity":"P2","file":"a.ts","line":3,"issue":"작은 문제","fix":"고침"},{"severity":"P1","file":"src/auth.ts","line":42,"issue":"토큰 갱신 실패 시 무한 루프","fix":"재시도 횟수 제한"}]}\n`;
    const r = parseReview(`\u001b[32m${prompt}\u001b[0m\r\n생각 중...\r\n${answer}tokens used: 1234`);
    expect(r?.verdict).toBe("fail");
    expect(r?.findings.map((f) => f.severity)).toEqual(["P1", "P2"]);
    expect(r?.findings[0]).toMatchObject({ file: "src/auth.ts", line: 42 });
  });

  it("returns null when the reviewer never answered (only the prompt echo)", () => {
    expect(parseReview(prompt)).toBeNull();
    expect(parseReview("no marker {\"verdict\":\"pass\"}")).toBeNull();
  });

  it("normalizes unknown verdicts and severities", () => {
    const r = parseReview(`${REVIEW_MARKER}\n{"verdict":"maybe","findings":[{"severity":"high","issue":"x"},{"issue":""}]}`);
    expect(r).toMatchObject({ verdict: "uncertain", summary: "", findings: [{ severity: "P3", issue: "x", line: null }] });
  });
});

describe("fixPrompt", () => {
  it("lists P1/P2 findings and asks to verify each before fixing", () => {
    const review: CrossReview = {
      sessionId: "r1",
      reviewer: "codex",
      mode: "review",
      status: "done",
      verdict: "fail",
      summary: "",
      startedAt: 1,
      endedAt: 2,
      findings: [
        { severity: "P1", file: "src/auth.ts", line: 42, issue: "무한 루프", fix: "횟수 제한" },
        { severity: "P3", file: "x.ts", line: null, issue: "이름", fix: "" },
      ],
    };
    const p = fixPrompt(entry(), review);
    expect(p).toContain("[P1] src/auth.ts:42 — 무한 루프 → 횟수 제한");
    expect(p).not.toContain("이름");
    expect(p).toContain("틀린 지적이면 고치지 말고");
  });
});

describe("collectDiff", () => {
  it("includes tracked changes and new files of the session only", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-cr-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    fs.writeFileSync(path.join(repo, "other.txt"), "x\n");
    git("add", ".");
    git("commit", "-qm", "init");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
    fs.writeFileSync(path.join(repo, "other.txt"), "changed elsewhere\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "fresh\n");
    return collectDiff(repo, ["a.txt", "new.txt"]).then((d) => {
      expect(d).toContain("+two");
      expect(d).toContain("+fresh");
      expect(d).not.toContain("changed elsewhere");
    });
  });
});
