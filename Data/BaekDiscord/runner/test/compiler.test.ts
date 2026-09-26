import { describe, expect, it } from "vitest";
import { compileAndRun, judge, Semaphore } from "../src/compiler/run.js";
import { LANGUAGES, languageInfos, probeLanguage } from "../src/compiler/languages.js";

const limits = { compileTimeoutMs: 20_000, runTimeoutMaxMs: 30_000, outputCapBytes: 64 * 1024 };
const available = new Set(languageInfos().filter((l) => l.available).map((l) => l.id));
const only = (id: string) => (available.has(id) ? it : it.skip);

describe("languages", () => {
  it("lists every defined language with a template", () => {
    const infos = languageInfos();
    expect(infos.map((l) => l.id)).toEqual(LANGUAGES.map((l) => l.id));
    for (const l of infos) expect(l.template.length).toBeGreaterThan(10);
  });

  it("probes with a cached result", () => {
    const def = LANGUAGES[0];
    expect(probeLanguage(def)).toBe(probeLanguage(def));
  });
});

describe("compileAndRun", () => {
  only("python")("runs the python template with stdin", async () => {
    const tpl = LANGUAGES.find((l) => l.id === "python")!.template;
    const r = await compileAndRun({ language: "python", code: tpl, stdin: "3 4\n" }, limits);
    expect(r.compile).toBeNull();
    expect(r.run?.ok).toBe(true);
    expect(r.run?.stdout.trim()).toBe("7");
  });

  only("c")("compiles and runs C", async () => {
    const tpl = LANGUAGES.find((l) => l.id === "c")!.template;
    const r = await compileAndRun({ language: "c", code: tpl, stdin: "10 20" }, limits);
    expect(r.compile?.ok).toBe(true);
    expect(r.run?.stdout.trim()).toBe("30");
  });

  only("cpp")("reports compile errors without running", async () => {
    const r = await compileAndRun({ language: "cpp", code: "int main() { return x; }" }, limits);
    expect(r.compile?.ok).toBe(false);
    expect(r.compile?.stderr).toMatch(/error/);
    expect(r.run).toBeNull();
  });

  only("java")("compiles and runs Java Main", async () => {
    const tpl = LANGUAGES.find((l) => l.id === "java")!.template;
    const r = await compileAndRun({ language: "java", code: tpl, stdin: "5 6\n" }, limits);
    expect(r.compile?.ok).toBe(true);
    expect(r.run?.stdout.trim()).toBe("11");
  });

  only("javascript")("runs node", async () => {
    const tpl = LANGUAGES.find((l) => l.id === "javascript")!.template;
    const r = await compileAndRun({ language: "javascript", code: tpl, stdin: "1 2" }, limits);
    expect(r.run?.stdout.trim()).toBe("3");
  });

  only("python")("kills an infinite loop on timeout", async () => {
    const r = await compileAndRun({ language: "python", code: "while True: pass\n", timeoutMs: 500 }, limits);
    expect(r.run?.timedOut).toBe(true);
    expect(r.run?.ok).toBe(false);
    expect(r.run!.ms).toBeLessThan(5000);
  });

  only("python")("caps runaway output", async () => {
    const r = await compileAndRun(
      { language: "python", code: "import sys\nwhile True:\n    sys.stdout.write('x' * 4096)\n", timeoutMs: 5000 },
      limits,
    );
    expect(r.run?.truncated).toBe(true);
    expect(r.run!.stdout.length).toBeLessThanOrEqual(limits.outputCapBytes);
  });

  it("rejects unknown languages", async () => {
    await expect(compileAndRun({ language: "cobol", code: "x" }, limits)).rejects.toThrow(/unsupported/);
  });
});

describe("judge", () => {
  it("ignores trailing whitespace and final newline", () => {
    expect(judge("7 \n", "7")).toBe(true);
    expect(judge("1\r\n2\r\n", "1\n2")).toBe(true);
    expect(judge("7", "8")).toBe(false);
  });
});

describe("Semaphore", () => {
  it("limits concurrency", async () => {
    const s = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const release = await s.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
  });
});
