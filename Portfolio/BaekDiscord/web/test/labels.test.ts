import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_LABELS, RunnerCallError, describeError } from "../lib/runner/labels";

const doc = fs.readFileSync(path.resolve(__dirname, "../../docs/errors.md"), "utf8");
const codes = [...doc.matchAll(/^## ([a-z_]+)\s*$/gm)].map((m) => m[1]);

describe("error labels", () => {
  it("has a Korean label for every code in docs/errors.md", () => {
    expect(codes.length).toBeGreaterThan(10);
    expect(codes.filter((c) => !ERROR_LABELS[c])).toEqual([]);
    expect(Object.keys(ERROR_LABELS).filter((c) => !codes.includes(c))).toEqual([]);
  });

  it("uses the label for English runner text and keeps specific Korean text", () => {
    expect(describeError({ code: "session_not_found", message: "no such session" })).toBe(ERROR_LABELS.session_not_found);
    expect(describeError({ code: "folder_missing", message: "폴더가 없습니다: D:/x" })).toBe("폴더가 없습니다: D:/x");
    expect(describeError({ message: "something new" })).toBe("something new");
  });

  it("adds the wait for after_ms and the trace id for internal failures", () => {
    expect(describeError({ code: "auth_locked", message: "locked out", retry: "after_ms", retryAfterMs: 15 * 60_000 })).toContain("15분 뒤");
    const t = describeError({ code: "internal", message: "내부 오류 (traceId ab12cd34)", traceId: "ab12cd34" });
    expect(t).toContain(ERROR_LABELS.internal);
    expect(t).toContain("ab12cd34");
  });

  it("RunnerCallError carries the contract fields", () => {
    const e = new RunnerCallError({ code: "busy", error: "chat busy", retry: "after_ms" });
    expect(e.message).toBe(ERROR_LABELS.busy);
    expect(e.info.code).toBe("busy");
  });
});
