import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluate, formatText, main, replayEngine } from "../src/supervisor/eval.js";
import { readJsonl } from "../src/store/files.js";
import type { LogRecord } from "../src/supervisor/decisions.js";
import type { Brain } from "../src/supervisor/brain.js";

const fixture = path.resolve(__dirname, "fixtures/decisions.sample.jsonl");

describe("eval:supervisor", () => {
  it("aggregates the fixture with denominators and reports sample shortage", () => {
    const r = evaluate(fixture);
    expect(r.metrics.decisions).toBe(6);
    expect(r.metrics.answered).toBe(5);
    expect(r.metrics.approval).toMatchObject({ hit: 1, total: 4, enough: false });
    expect(r.metrics.autoAgreement).toMatchObject({ hit: 2, total: 3, undetermined: 0 });
    expect(r.metrics.incidents).toEqual({ autoReverted: 1, missedWaits: 1 });
    expect(r.replay.replayed).toBe(6);
    expect(r.status).toBe("insufficient_samples");
    expect(formatText(r)).toContain("표본 부족");
  });

  it("exits 0 with --json, 1 for a missing or unreadable log, 2 for bad arguments", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--file", fixture, "--json"])).toBe(0);
      expect(JSON.parse(out.mock.calls[0][0] as string).status).toBe("insufficient_samples");
      expect(await main(["--file", path.join(os.tmpdir(), "no-such-decisions.jsonl")])).toBe(1);
      const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-eval-")), "d.jsonl");
      fs.writeFileSync(broken, "garbage\nmore garbage\n");
      expect(await main(["--file", broken])).toBe(1);
      expect(await main(["--engine", "api"])).toBe(2); // a model run needs --limit
      expect(await main(["--limit", "5"])).toBe(2);
      expect(await main(["--engine", "gpt", "--limit", "5"])).toBe(2);
      expect(await main(["--engine", "api", "--limit", "0"])).toBe(2);
      expect(await main(["--what"])).toBe(2);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  it("re-runs a model engine on the newest answered decisions, within --limit", async () => {
    const seen: string[] = [];
    const brain: Brain = {
      kind: "api",
      model: "fake",
      async complete() {
        return null;
      },
      async judge(input) {
        seen.push(input.sessionName);
        return { state: "waiting_input", summary: "", action: "respond", input: "y", confidence: 0.9, rationale: "" };
      },
    };
    const { records } = readJsonl<LogRecord>(fixture);
    const all = await replayEngine(records, brain, 500);
    expect(all.asked + all.skippedDanger).toBe(5); // the 5 decisions a person answered
    expect(all.respond).toBe(all.asked);
    expect(all.agreement.total + all.agreement.undetermined).toBe(all.asked);
    seen.length = 0;
    const two = await replayEngine(records, brain, 2);
    expect(two.asked + two.skippedDanger).toBe(2);

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["--file", fixture, "--engine", "api", "--limit", "3", "--json"], { brain })).toBe(0);
      expect(JSON.parse(out.mock.calls[0][0] as string).engineReplay).toMatchObject({ engine: "api", model: "fake" });
      expect(await main(["--file", fixture, "--engine", "api", "--limit", "3"], { brain })).toBe(0);
      expect(out.mock.calls[1][0]).toContain("모델 재실행(api / fake)");
    } finally {
      out.mockRestore();
    }
  });
});
