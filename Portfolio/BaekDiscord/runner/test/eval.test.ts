import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluate, formatText, main } from "../src/supervisor/eval.js";

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

  it("exits 0 with --json, 1 for a missing or unreadable log, 2 for bad arguments", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main(["--file", fixture, "--json"])).toBe(0);
      expect(JSON.parse(out.mock.calls[0][0] as string).status).toBe("insufficient_samples");
      expect(main(["--file", path.join(os.tmpdir(), "no-such-decisions.jsonl")])).toBe(1);
      const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-eval-")), "d.jsonl");
      fs.writeFileSync(broken, "garbage\nmore garbage\n");
      expect(main(["--file", broken])).toBe(1);
      expect(main(["--engine", "api"])).toBe(2);
      expect(main(["--what"])).toBe(2);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});
