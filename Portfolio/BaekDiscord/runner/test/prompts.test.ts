import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Brain } from "../src/supervisor/brain.js";
import type { WorkLogEntry } from "../src/protocol.js";
import { heuristicSummary, refinePrompt, summarizeWork, templateRefine } from "../src/prompts.js";
import { WorkLog, gitDelta } from "../src/worklog.js";

const ctx = { cwd: "D:\\Projects\\App\\RunClue", markers: ["git", "node"], branch: "main" };

function fakeBrain(reply: string | null, kind: Brain["kind"] = "api"): Brain & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind,
    model: null,
    calls,
    async complete(_system, messages) {
      calls.push(messages.map((m) => m.content).join("\n"));
      return reply;
    },
    async judge() {
      return null;
    },
  };
}

function entry(over: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: "abc12345",
    name: "fix",
    preset: "claude-print",
    cwd: ctx.cwd,
    goal: null,
    prompt: "테스트 고쳐줘",
    startedAt: 1,
    endedAt: 2,
    status: "exited",
    exitCode: 0,
    bytes: 10,
    tail: ["Running tests", "All 12 tests passed", "[runner] process exited (code 0)"],
    git: { branch: "main", insertions: 4, deletions: 1, files: ["src/a.ts"] },
    summary: "",
    summarySource: "heuristic",
    ...over,
  };
}

describe("refinePrompt", () => {
  it("falls back to a structured template without a model", async () => {
    const r = await refinePrompt(fakeBrain(null, "heuristic"), "  로그인 버그   고쳐줘 ", ctx);
    expect(r.source).toBe("template");
    expect(r.prompt).toContain("목표: 로그인 버그 고쳐줘");
    expect(r.prompt).toContain("커밋·푸시·삭제·배포");
    expect(r.goal).toContain("테스트");
  });

  it("uses the model's JSON and passes folder context", async () => {
    const brain = fakeBrain('설명 {"title":"로그인 수정","prompt":"목표: ...","goal":"로그인 테스트 통과","preset":"claude","notes":["세션 만료로 가정"]} 끝');
    const r = await refinePrompt(brain, "로그인 고쳐", ctx);
    expect(r).toMatchObject({ source: "brain", title: "로그인 수정", preset: "claude", goal: "로그인 테스트 통과", notes: ["세션 만료로 가정"] });
    expect(brain.calls[0]).toContain("RunClue");
    expect(brain.calls[0]).toContain("git, node");
  });

  it("keeps the template when the model returns garbage", async () => {
    const r = await refinePrompt(fakeBrain("모르겠어요"), "빌드 고쳐", ctx);
    expect(r.source).toBe("template");
    expect(templateRefine("빌드 고쳐", ctx).prompt).toBe(r.prompt);
  });
});

describe("summaries", () => {
  it("heuristic summary has the outcome, git delta and last meaningful line", () => {
    expect(heuristicSummary(entry())).toBe("정상 종료 · 변경 +4 -1 · All 12 tests passed");
    expect(heuristicSummary(entry({ status: "killed", exitCode: null, git: null, tail: [] }))).toBe("중간에 종료됨");
    expect(heuristicSummary(entry({ exitCode: 2 }))).toMatch(/^실패 \(code 2\)/);
  });

  it("model summary is skipped without a model", async () => {
    expect(await summarizeWork(fakeBrain(null, "heuristic"), entry())).toBeNull();
    expect(await summarizeWork(fakeBrain(" 테스트를 고쳤습니다. "), entry())).toBe("테스트를 고쳤습니다.");
  });
});

describe("WorkLog", () => {
  it("persists entries, lists newest first and survives a reload", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-log-")), ".data", "worklog.jsonl");
    const log = new WorkLog(file);
    log.add(entry({ id: "a1", endedAt: 1 }));
    log.add(entry({ id: "b2", endedAt: 2 }));
    log.update("a1", { summary: "요약됨", summarySource: "brain" });
    fs.appendFileSync(file, "{torn");
    const again = new WorkLog(file);
    expect(again.list(10).map((e) => e.id)).toEqual(["b2", "a1"]);
    expect(again.get("a1")).toMatchObject({ summary: "요약됨", summarySource: "brain" });
  });
});

describe("gitDelta", () => {
  it("counts only what changed after the session started", () => {
    const before = [
      { path: "a.ts", status: "M", insertions: 10, deletions: 2 },
      { path: "untouched.ts", status: "M", insertions: 5, deletions: 5 },
    ];
    const after = {
      repoRoot: "",
      checkedAt: 0,
      branch: "main",
      ahead: 0,
      behind: 0,
      insertions: 0,
      deletions: 0,
      recentCommits: [],
      changed: [
        { path: "a.ts", status: "M", insertions: 14, deletions: 2 },
        { path: "untouched.ts", status: "M", insertions: 5, deletions: 5 },
        { path: "new.ts", status: "?", insertions: 7, deletions: 0 },
      ],
    };
    expect(gitDelta(before, after)).toEqual({ branch: "main", insertions: 11, deletions: 0, files: ["a.ts", "new.ts"] });
    expect(gitDelta(null, after).files).toHaveLength(3);
  });
});
