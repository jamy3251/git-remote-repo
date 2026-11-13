import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PlaybookStore, parseEntry, renderEntry, score, slugify } from "../src/playbook.js";

const input = { title: "Git Bash curl 한글 깨짐", tags: ["curl", "인코딩"], symptom: "curl -d 로 한글을 보내면 깨진다", cause: "셸 인코딩", fix: "UTF-8 JSON 파일 + --data-binary", example: "curl --data-binary @a.json", related: ["web/test"] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "devhub-pb-"));

describe("playbook file format", () => {
  it("round-trips an entry through markdown", () => {
    const e = parseEntry("x", renderEntry(input), 1);
    expect(e).toMatchObject({ title: input.title, tags: input.tags, symptom: input.symptom, cause: input.cause, fix: input.fix, example: input.example, related: input.related });
  });

  it("reads CRLF files and ignores unknown sections", () => {
    const raw = "---\r\ntitle: T\r\ntags: [a, b]\r\n---\r\n\r\n## 증상\r\n뭔가\r\n\r\n## 잡담\r\n무시\r\n\r\n## 해결\r\n이렇게\r\n";
    const e = parseEntry("t", raw, 1);
    expect(e.tags).toEqual(["a", "b"]);
    expect(e.symptom).toBe("뭔가");
    expect(e.fix).toBe("이렇게");
  });

  it("makes safe ids", () => {
    expect(slugify("../../Evil Name!")).toBe("evil-name");
    expect(slugify("!!!")).toBe("entry");
  });
});

describe("search", () => {
  const a = parseEntry("a", renderEntry(input), 1);
  it("requires every word to match and ranks title/tag hits above body hits", () => {
    expect(score(a, "curl 한글")).toBeGreaterThan(0);
    expect(score(a, "curl 없는단어")).toBe(0);
    expect(score(a, "curl")).toBeGreaterThan(score(a, "셸"));
  });

  it("finds an entry when the query word carries a Korean particle", () => {
    expect(score(a, "한글이 깨진다")).toBeGreaterThan(0);
    expect(score(a, "인코딩을")).toBeGreaterThan(0);
    expect(score(a, "없는단어를")).toBe(0);
  });
});

describe("PlaybookStore", () => {
  it("saves, lists and searches; a repeated title does not overwrite", () => {
    const dir = path.join(tmp(), "playbook");
    const s = new PlaybookStore(dir);
    const first = s.save(input);
    const second = s.save(input);
    expect(first.id).not.toBe(second.id);
    expect(s.list()).toHaveLength(2);
    expect(s.search("인코딩")).toHaveLength(2);
    expect(s.search("zzz")).toHaveLength(0);
  });

  it("overwrites only with an explicit valid id and never escapes the directory", () => {
    const dir = path.join(tmp(), "playbook");
    const s = new PlaybookStore(dir);
    const e = s.save(input);
    s.save({ ...input, fix: "새 해결" }, e.id);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0].fix).toBe("새 해결");
    const evil = s.save(input, "../../escape");
    expect(fs.existsSync(path.join(dir, `${evil.id}.md`))).toBe(true);
    expect(evil.id).not.toContain("..");
    expect(fs.readdirSync(path.dirname(dir))).toEqual(["playbook"]);
  });

  it("rejects entries without title, symptom or fix, and returns [] for a missing dir", () => {
    const s = new PlaybookStore(path.join(tmp(), "nope"));
    expect(s.list()).toEqual([]);
    expect(() => s.save({ ...input, title: "" })).toThrow();
    expect(() => s.save({ ...input, fix: "" })).toThrow();
  });
});
