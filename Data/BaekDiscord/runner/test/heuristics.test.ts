import { describe, expect, it } from "vitest";
import { heuristicSuggestion, isSafeAutoInput, judgeHeuristically, type HeuristicInput } from "../src/supervisor/heuristics.js";
import { stripAnsi, tailLines } from "../src/supervisor/ansi.js";
import { compactTail } from "../src/supervisor/supervisor.js";

const NOW = 10_000_000;
const base = (over: Partial<HeuristicInput>): HeuristicInput => ({
  tail: [],
  lastOutputAt: NOW - 20_000,
  createdAt: NOW - 120_000,
  now: NOW,
  status: "running",
  exitCode: null,
  mode: "pty",
  preset: "claude",
  ...over,
});

describe("stripAnsi / tailLines", () => {
  it("removes CSI, OSC and keeps the last carriage-return rewrite", () => {
    const raw = "\u001b[2J\u001b[m\u001b[Hhello\u001b]0;title\u0007\r\nprogress 10%\rprogress 90%\r\n";
    expect(stripAnsi(raw)).toBe("hello\nprogress 90%\n");
    expect(tailLines(raw, 5)).toEqual(["hello", "progress 90%"]);
  });
});

describe("judgeHeuristically", () => {
  it("reports process end states from status", () => {
    expect(judgeHeuristically(base({ status: "exited", exitCode: 0 })).state).toBe("done");
    expect(judgeHeuristically(base({ status: "exited", exitCode: 2 })).state).toBe("error");
    expect(judgeHeuristically(base({ status: "killed" })).state).toBe("killed");
  });

  it("is working while output flows", () => {
    const j = judgeHeuristically(base({ tail: ["compiling…", "linking…"], lastOutputAt: NOW - 1_000 }));
    expect(j.state).toBe("working");
  });

  it("detects a yes/no prompt once output has settled", () => {
    const j = judgeHeuristically(base({ tail: ["About to overwrite config.json", "Continue? (y/n)"] }));
    expect(j.state).toBe("waiting_input");
    expect(j.prompt?.kind).toBe("yes_no");
  });

  it("detects Claude Code permission menus with options", () => {
    const tail = ["Do you want to make this edit to src/app.ts?", "❯ 1. Yes", "  2. Yes, and don't ask again for this session", "  3. No, and tell Claude what to do differently"];
    const j = judgeHeuristically(base({ tail }));
    expect(j.state).toBe("waiting_input");
    expect(j.prompt?.kind).toBe("menu");
    expect(j.prompt?.options?.[0]).toMatch(/^1\. Yes/);
  });

  it("detects press-enter prompts", () => {
    const j = judgeHeuristically(base({ tail: ["Installation complete.", "Press Enter to continue"] }));
    expect(j.prompt?.kind).toBe("enter");
    expect(heuristicSuggestion(j)?.kind).toBe("respond");
  });

  it("treats a shell prompt as idle, not waiting", () => {
    const j = judgeHeuristically(base({ tail: ["npm test", "21 passed", "PS D:\\Projects\\Data>"] }));
    expect(j.state).toBe("idle");
  });

  it("flags danger and escalates instead of proposing a response", () => {
    const j = judgeHeuristically(base({ tail: ["This will run: rm -rf build/ dist/", "Proceed? (y/n)"] }));
    expect(j.state).toBe("waiting_input");
    expect(j.danger).toBe(true);
    expect(heuristicSuggestion(j)?.kind).toBe("escalate");
  });

  it("flags errors after output stops", () => {
    const j = judgeHeuristically(base({ tail: ["npm ERR! code ELIFECYCLE", "npm ERR! Failed at the build script"], lastOutputAt: NOW - 15_000 }));
    expect(j.state).toBe("error");
  });

  it("goes idle after a long silence", () => {
    const j = judgeHeuristically(base({ tail: ["thinking…"], lastOutputAt: NOW - 60_000 }));
    expect(j.state).toBe("idle");
  });
});

describe("isSafeAutoInput", () => {
  it("allows only trivial acknowledgements", () => {
    expect(isSafeAutoInput("\r")).toBe(true);
    expect(isSafeAutoInput("y")).toBe(true);
    expect(isSafeAutoInput("2")).toBe(true);
    expect(isSafeAutoInput("rm -rf /")).toBe(false);
    expect(isSafeAutoInput("yes --force")).toBe(false);
  });
});

describe("compactTail", () => {
  it("dedupes repeats, strips box drawing, redacts and caps size", () => {
    const lines = ["╭──────╮", "│ hello │", "spinner", "spinner", "spinner", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "x".repeat(400)];
    const out = compactTail(lines, 10_000);
    expect(out).toContain("hello");
    expect(out).toContain("(같은 줄 2회 반복)");
    expect(out.join("\n")).toContain("[REDACTED]");
    expect(out[out.length - 1].length).toBeLessThanOrEqual(301);
    expect(compactTail(Array.from({ length: 200 }, (_, i) => `line ${i} ${"y".repeat(50)}`), 500).join("\n").length).toBeLessThanOrEqual(520);
  });
});
