import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlLog, ROTATE_BYTES, readJsonl, writeJsonAtomic } from "../src/store/files.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "devhub-store-"));

describe("jsonl", () => {
  it("skips broken lines and a cut-off last line, and counts them", () => {
    const f = path.join(tmp(), "log.jsonl");
    fs.writeFileSync(f, '{"a":1}\nnot json\n{"a":2}\n{"a":3,"b":"cut');
    const r = readJsonl<{ a: number }>(f);
    expect(r.records.map((x) => x.a)).toEqual([1, 2]);
    expect(r.skipped).toBe(2);
    let reported = 0;
    new JsonlLog(f, { rotate: true, onSkipped: (n) => (reported = n) }).open();
    expect(reported).toBe(2);
  });

  it("treats a missing file as empty and appends", () => {
    const f = path.join(tmp(), "sub", "log.jsonl");
    const log = new JsonlLog<{ n: number }>(f, { rotate: false });
    expect(log.open()).toEqual([]);
    log.append({ n: 1 });
    log.append({ n: 2 });
    expect(readJsonl<{ n: number }>(f).records).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("rotates an oversized file to .1 only when asked", () => {
    const dir = tmp();
    const big = `${JSON.stringify({ pad: "x".repeat(1000) })}\n`.repeat(Math.ceil(ROTATE_BYTES / 1000) + 10);
    const a = path.join(dir, "events.jsonl");
    fs.writeFileSync(a, big);
    new JsonlLog(a, { rotate: true }).open();
    expect(fs.existsSync(`${a}.1`)).toBe(true);
    expect(fs.existsSync(a)).toBe(false);
    const b = path.join(dir, "decisions.jsonl");
    fs.writeFileSync(b, big);
    new JsonlLog(b, { rotate: false }).open();
    expect(fs.existsSync(`${b}.1`)).toBe(false);
  });
});

describe("writeJsonAtomic", () => {
  it("retries a busy rename and then succeeds", () => {
    const f = path.join(tmp(), "doc.json");
    let calls = 0;
    writeJsonAtomic(f, { ok: true }, {
      sleep: () => {},
      rename: (a, b) => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        fs.renameSync(a, b);
      },
    });
    expect(calls).toBe(3);
    expect(JSON.parse(fs.readFileSync(f, "utf8"))).toEqual({ ok: true });
  });

  it("gives up after three retries, throws, and leaves no temp file", () => {
    const dir = tmp();
    const f = path.join(dir, "doc.json");
    let calls = 0;
    expect(() =>
      writeJsonAtomic(f, { ok: true }, {
        sleep: () => {},
        rename: () => {
          calls += 1;
          throw Object.assign(new Error("locked"), { code: "EPERM" });
        },
      }),
    ).toThrow(/locked/);
    expect(calls).toBe(4);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
