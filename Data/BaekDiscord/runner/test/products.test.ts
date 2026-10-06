import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductMeta } from "../src/protocol.js";
import { bucket, discoverProducts, editTimes, flagsOf, healthOf, weekStarts } from "../src/products.js";

const DAY = 24 * 3600_000;

function tree(spec: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-prod-")));
  for (const [rel, body] of Object.entries(spec)) {
    const full = path.join(root, rel);
    if (rel.endsWith("/")) fs.mkdirSync(full, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
  }
  return root;
}

const meta = (over: Partial<ProductMeta> = {}): ProductMeta => ({ stage: null, note: "", hidden: false, pinned: false, deployUrl: null, insight: null, ping: null, ...over });

describe("discoverProducts", () => {
  it("finds project folders under category folders and does not look inside a product", () => {
    const root = tree({
      "App/Shop/package.json": "{}",
      "App/Shop/web/package.json": "{}",
      "Games/Boxing/Game/ProjectSettings/": "",
      "Docs/Paper/README.md": "# paper",
      "Mono/.git/": "",
      "Mono/svc-a/go.mod": "",
      "Mono/svc-b/Cargo.toml": "",
      "Empty/notes/": "",
      "App/node_modules/x/package.json": "{}",
    });
    const rel = discoverProducts(root).map((p) => path.relative(root, p).replace(/\\/g, "/"));
    expect(rel).toEqual(["App/Shop", "Docs/Paper", "Games/Boxing/Game", "Mono/svc-a", "Mono/svc-b"]);
  });

  it("treats a git/README-only folder as a product when nothing below it is", () => {
    const root = tree({ "Lab/.git/": "", "Lab/README.md": "x" });
    expect(discoverProducts(root).map((p) => path.basename(p))).toEqual(["Lab"]);
  });
});

describe("weeks and health", () => {
  it("buckets times into Monday-start weeks, oldest first", () => {
    const now = new Date(2026, 9, 7, 15).getTime(); // Wed
    const weeks = weekStarts(now, 3);
    expect(new Date(weeks[2]).getDay()).toBe(1);
    expect(weeks[2] - weeks[1]).toBe(7 * DAY);
    expect(bucket([now, now - DAY, weeks[0] + 1, weeks[0] - 1], weeks)).toEqual([1, 0, 2]);
  });

  it("calls a product active within a week, slowing within a month, dormant after", () => {
    const now = Date.now();
    expect(healthOf(now - 2 * DAY, now)).toBe("active");
    expect(healthOf(now - 10 * DAY, now)).toBe("slowing");
    expect(healthOf(now - 40 * DAY, now)).toBe("dormant");
    expect(healthOf(null, now)).toBe("dormant");
  });
});

describe("flagsOf", () => {
  const now = Date.now();
  const work = { count: 0, lastAt: null, lastOutcome: null, lastReview: null };
  const git = { ownRepo: true, branch: "main", lastCommitAt: now - 10 * DAY, lastCommit: "x", dirty: 4, ahead: 2 };

  it("flags stale uncommitted work, unpushed commits, a down deploy and failed work", () => {
    const f = flagsOf({ git, work: { ...work, lastOutcome: "failed", lastReview: "fail" }, meta: meta({ ping: { at: now, ok: false, status: 503, ms: 10, error: null } }) }, now);
    expect(f.map((x) => x.kind)).toEqual(["dirty", "unpushed", "down", "failed", "review"]);
    expect(f[0].text).toBe("미커밋 변경 4개 · 마지막 커밋 10일 전");
    expect(f[2].text).toBe("배포 응답 없음 (503)");
  });

  it("does not nag about fresh uncommitted work", () => {
    expect(flagsOf({ git: { ...git, lastCommitAt: now - DAY, ahead: 0 }, work, meta: meta() }, now)).toEqual([]);
  });
});

describe("editTimes", () => {
  it("reads modification times of uncommitted files, skipping deletions and missing files", () => {
    const root = tree({ "src/a.ts": "a", "new.ts": "n" });
    const t = new Date(2026, 8, 1).getTime();
    fs.utimesSync(path.join(root, "src/a.ts"), t / 1000, t / 1000);
    const out = editTimes(root, [" M src/a.ts", "?? new.ts", " D gone.ts", "R  old.ts -> src/a.ts", " M missing.ts"].join("\n"));
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(t);
  });
});
