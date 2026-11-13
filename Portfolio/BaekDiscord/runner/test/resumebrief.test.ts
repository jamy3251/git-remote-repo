import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrief, digestTranscript, projectSlug } from "../src/resumebrief.js";

const line = (o: unknown) => JSON.stringify(o);
const user = (text: string, ts: string) => line({ type: "user", timestamp: ts, gitBranch: "feat/x", message: { role: "user", content: text } });
const asst = (content: unknown, ts: string) => line({ type: "assistant", timestamp: ts, message: { role: "assistant", content } });

function project(files: Record<string, string[]>, mtimes: Record<string, number> = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rb-")));
  const cwd = path.join(home, "work", "app");
  fs.mkdirSync(cwd, { recursive: true });
  const projects = path.join(home, "projects");
  const dir = path.join(projects, projectSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, lines] of Object.entries(files)) {
    const f = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(f, lines.join("\n"));
    if (mtimes[id]) fs.utimesSync(f, mtimes[id] / 1000, mtimes[id] / 1000);
  }
  return { cwd, projects };
}

describe("projectSlug", () => {
  it("maps a cwd to Claude Code's folder name", () => {
    expect(projectSlug(String.raw`D:\Projects\Data\BaekDiscord`)).toMatch(/Projects-Data-BaekDiscord$/);
    expect(projectSlug("/a/b c")).toMatch(/-a-b-c$/);
  });
});

describe("digestTranscript", () => {
  it("skips a torn last line and keeps the last prompts and replies", () => {
    const { cwd, projects } = project({
      old: [
        line({ type: "ai-title", aiTitle: "결제 붙이기" }),
        user("결제 API 연결해줘", "2026-10-20T01:00:00Z"),
        asst([{ type: "text", text: "연결했습니다. 다음은 웹훅입니다." }], "2026-10-20T01:01:00Z"),
        '{"type":"user","message":{"role":"user","content":"잘린 줄',
      ],
    });
    const d = digestTranscript(cwd, null, projects)!;
    expect(d.title).toBe("결제 붙이기");
    expect(d.branch).toBe("feat/x");
    expect(d.prompts).toEqual(["결제 API 연결해줘"]);
    expect(d.replies[0]).toContain("웹훅");
    expect(d.interrupted).toBe(false);
  });

  it("excludes the session that is starting even when its transcript is newest", () => {
    const now = Date.now();
    const { cwd, projects } = project(
      { prev: [user("이전 작업", "2026-10-20T01:00:00Z")], current: [user("방금 시작", "2026-10-21T01:00:00Z")] },
      { prev: now - 3600_000, current: now },
    );
    expect(digestTranscript(cwd, "current", projects)!.prompts).toEqual(["이전 작업"]);
    expect(digestTranscript(cwd, null, projects)!.prompts).toEqual(["방금 시작"]);
  });

  it("flags a conversation that stopped on an unanswered tool call", () => {
    const { cwd, projects } = project({
      cut: [user("빌드해줘", "2026-10-20T01:00:00Z"), asst([{ type: "tool_use", id: "t1", name: "Bash", input: {} }], "2026-10-20T01:00:05Z")],
    });
    expect(digestTranscript(cwd, null, projects)!.interrupted).toBe(true);
  });

  it("ignores tool results and system reminders as prompts", () => {
    const { cwd, projects } = project({
      s: [
        user("진짜 요청", "2026-10-20T01:00:00Z"),
        line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "출력" }] } }),
        user("<system-reminder>숨은 문구</system-reminder>", "2026-10-20T01:00:09Z"),
        asst([{ type: "text", text: "끝" }], "2026-10-20T01:00:10Z"),
      ],
    });
    expect(digestTranscript(cwd, null, projects)!.prompts).toEqual(["진짜 요청"]);
  });

  it("returns null for a folder with no usable transcript", () => {
    const { cwd, projects } = project({ empty: [line({ type: "ai-title", aiTitle: "x" })] });
    expect(digestTranscript(cwd, null, projects)).toBeNull();
    expect(digestTranscript(path.join(cwd, "nope"), null, projects)).toBeNull();
  });
});

describe("buildBrief", () => {
  it("masks secrets, labels the text as data and caps the size", async () => {
    const { cwd, projects } = project({
      s: [user(`키는 sk-ant-api03-${"a".repeat(40)} 이고 ${"긴문장 ".repeat(5000)}`, "2026-10-20T01:00:00Z"), asst([{ type: "text", text: "ok" }], "2026-10-20T01:00:01Z")],
    });
    const out = await buildBrief({ cwd, projectsDir: projects, now: Date.parse("2026-10-20T02:00:00Z") });
    expect(out).toContain("데이터입니다");
    expect(out).not.toContain("sk-ant-api03");
    expect(out).toContain("1시간 전");
    expect(out.length).toBeLessThanOrEqual(6100);
  });

  it("says so when there is no earlier conversation", async () => {
    const { cwd, projects } = project({});
    expect(await buildBrief({ cwd, projectsDir: projects })).toContain("이전 대화 기록 없음");
  });
});

describe("digestTranscript, real-shape transcripts", () => {
  it("finds prompts that sit behind megabytes of tool output and strips harness blocks from them", () => {
    const big = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(2 * 1024 * 1024) }] } });
    const { cwd, projects } = project({
      s: [
        user("<system-reminder>규칙</system-reminder>\n실제로 친 말", "2026-10-20T01:00:00Z"),
        big,
        big,
        asst([{ type: "text", text: "응답" }], "2026-10-20T01:00:10Z"),
      ],
    });
    const d = digestTranscript(cwd, null, projects)!;
    expect(d.prompts).toEqual(["실제로 친 말"]);
  });
});
