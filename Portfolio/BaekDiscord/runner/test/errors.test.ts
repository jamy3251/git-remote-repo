import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERRORS, RunnerError, toErrorInfo } from "../src/errors.js";

const doc = fs.readFileSync(path.resolve(__dirname, "../../docs/errors.md"), "utf8");
const documented = [...doc.matchAll(/^## ([a-z_]+)\s*$/gm)].map((m) => m[1]);

describe("error codes", () => {
  it("every code has a section in docs/errors.md, and the doc lists no stale code", () => {
    expect(ERROR_CODES.filter((c) => !documented.includes(c))).toEqual([]);
    expect(documented.filter((c) => !(ERROR_CODES as string[]).includes(c))).toEqual([]);
  });

  it("the doc states each code's status and retry", () => {
    for (const code of ERROR_CODES) {
      const section = doc.split(`## ${code}`)[1].split("\n## ")[0];
      expect(section, code).toContain(String(ERRORS[code].status));
      expect(section, code).toContain(`\`${ERRORS[code].retry}\``);
    }
  });
});

describe("toErrorInfo", () => {
  it("keeps an expected error's message and code", () => {
    const info = toErrorInfo(new RunnerError("busy", "이미 요약 중입니다"), () => {});
    expect(info).toMatchObject({ status: 409, error: "이미 요약 중입니다", code: "busy", retry: "after_ms" });
    expect(info.traceId).toBeUndefined();
  });

  it("masks an unexpected error and logs it under a trace id", () => {
    const logged: string[] = [];
    const info = toErrorInfo(new Error("spawn failed with token admin-secret-123"), (id, detail) => logged.push(`${id} ${detail}`), ["admin-secret-123"]);
    expect(info.status).toBe(500);
    expect(info.code).toBe("internal");
    expect(info.traceId).toMatch(/^[0-9a-f]{8}$/);
    expect(info.error).not.toContain("spawn failed");
    expect(info.error).toContain(info.traceId!);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(info.traceId!);
    expect(logged[0]).toContain("spawn failed");
    expect(logged[0]).not.toContain("admin-secret-123");
  });

  it("treats JSON parse failures as invalid_json", () => {
    let err: unknown;
    try {
      JSON.parse("{");
    } catch (e) {
      err = e;
    }
    expect(toErrorInfo(err, () => {}).code).toBe("invalid_json");
  });
});
