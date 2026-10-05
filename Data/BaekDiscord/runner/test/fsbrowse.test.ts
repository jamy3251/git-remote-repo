import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listFolder, resolveInRoot } from "../src/fsbrowse.js";
import { claudeActivity } from "../src/cliactivity.js";

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-fs-")));
  root = path.join(base, "root");
  outside = path.join(base, "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(root, "App", "web", ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, "App", "web", "package.json"), "{}");
  fs.writeFileSync(path.join(root, "App", "web", "CLAUDE.md"), "# x");
  fs.mkdirSync(path.join(root, "App", "tool"), { recursive: true });
  fs.writeFileSync(path.join(root, "App", "tool", "pyproject.toml"), "");
  fs.mkdirSync(path.join(root, "App", "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(root, "App", ".cache"), { recursive: true });
  fs.writeFileSync(path.join(root, "App", "file.txt"), "not a folder");
  try {
    fs.symlinkSync(outside, path.join(root, "escape"), "junction");
  } catch {
    /* symlinks may be unavailable; the escape test then only covers ../ */
  }
});

afterAll(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("listFolder", () => {
  it("lists only real child folders with project markers", () => {
    const l = listFolder(root, path.join(root, "App"));
    expect(l.entries.map((e) => e.name)).toEqual(["tool", "web"]);
    const web = l.entries.find((e) => e.name === "web")!;
    expect(web.markers).toEqual(expect.arrayContaining(["git", "claude", "node"]));
    expect(l.entries.find((e) => e.name === "tool")!.markers).toEqual(["python"]);
    expect(l.parent).toBe(root);
    expect(l.crumbs.map((c) => c.path)).toEqual([root, path.join(root, "App")]);
  });

  it("starts at the root with no parent and accepts relative paths", () => {
    expect(listFolder(root).parent).toBeNull();
    expect(listFolder(root, "App").path).toBe(path.join(root, "App"));
  });

  it("refuses paths and links that escape the root", () => {
    expect(() => resolveInRoot(root, "..")).toThrow();
    expect(() => resolveInRoot(root, outside)).toThrow();
    if (fs.existsSync(path.join(root, "escape"))) {
      expect(() => resolveInRoot(root, path.join(root, "escape"))).toThrow();
      expect(listFolder(root).entries.map((e) => e.name)).not.toContain("escape");
    }
  });

  it("rejects missing folders and files", () => {
    expect(() => resolveInRoot(root, "nope")).toThrow();
    expect(() => resolveInRoot(root, path.join("App", "file.txt"))).toThrow();
  });
});

describe("CLI activity", () => {
  it("marks folders with running sessions or recent Claude work, counting descendants", () => {
    const web = path.join(root, "App", "web");
    const now = Date.now();
    const ctx = { running: [web, web], claude: [{ cwd: path.join(root, "App", "tool"), lastAt: now - 60_000 }, { cwd: outside, lastAt: now }], now };
    const top = listFolder(root, null, ctx);
    const app = top.entries.find((e) => e.name === "App")!;
    expect(app.running).toBe(2);
    expect(app.claudeAt).toBe(now - 60_000);
    const inner = listFolder(root, "App", ctx);
    expect(inner.entries.find((e) => e.name === "web")!.running).toBe(2);
    expect(inner.entries.find((e) => e.name === "tool")!.claudeAt).toBe(now - 60_000);
    // Live list: inside the root only, running first.
    expect(top.live.map((l) => l.path)).toEqual([web, path.join(root, "App", "tool")]);
  });

  it("reads each project's working folder from the newest Claude transcript", () => {
    const projects = path.join(path.dirname(root), "projects");
    const p = path.join(projects, "D--x");
    fs.mkdirSync(p, { recursive: true });
    const cwd = path.join(root, "App");
    fs.writeFileSync(path.join(p, "old.jsonl"), JSON.stringify({ cwd: outside }) + "\n");
    fs.utimesSync(path.join(p, "old.jsonl"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.writeFileSync(path.join(p, "new.jsonl"), JSON.stringify({ type: "user", cwd }) + "\n");
    fs.mkdirSync(path.join(projects, "empty"), { recursive: true });
    const act = claudeActivity(projects);
    expect(act).toHaveLength(1);
    expect(act[0].cwd).toBe(cwd);
    expect(Date.now() - act[0].lastAt).toBeLessThan(60_000);
  });
});
