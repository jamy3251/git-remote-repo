import fs from "node:fs";
import path from "node:path";
import type { PlaybookEntry, PlaybookInput } from "./protocol.js";
import type { Brain } from "./supervisor/brain.js";
import type { WorkLogEntry } from "./protocol.js";

const SECTIONS = [
  ["symptom", "증상"],
  ["cause", "원인"],
  ["fix", "해결"],
  ["example", "예시"],
  ["related", "관련"],
] as const;
const MAX_FIELD = 4000;

/** File-system-safe id from a title; keeps Hangul and ASCII, collapses the rest to dashes. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "entry";
}

export function parseEntry(id: string, raw: string, updatedAt: number): PlaybookEntry {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  let title = id;
  let tags: string[] = [];
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = /^(\w+):\s*(.*)$/.exec(line);
      if (!m) continue;
      if (m[1] === "title") title = m[2].trim().replace(/^["']|["']$/g, "") || id;
      if (m[1] === "tags") {
        tags = m[2]
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((t) => t.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    }
  }
  const out: PlaybookEntry = { id, title, tags, symptom: "", cause: "", fix: "", example: "", related: [], updatedAt };
  const parts = body.split(/^## +/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    const content = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    const key = SECTIONS.find(([, label]) => label === head)?.[0];
    if (!key) continue;
    if (key === "related") {
      out.related = content
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
    } else out[key] = content;
  }
  return out;
}

export function renderEntry(e: PlaybookInput): string {
  const tags = e.tags.map((t) => t.replace(/[,\]\n]/g, " ").trim()).filter(Boolean);
  const head = `---\ntitle: ${e.title.replace(/\n/g, " ").trim()}\ntags: [${tags.join(", ")}]\n---\n\n`;
  const sec = (label: string, body: string) => `## ${label}\n${body.trim()}\n\n`;
  return (
    head +
    sec("증상", e.symptom) +
    sec("원인", e.cause) +
    sec("해결", e.fix) +
    (e.example.trim() ? sec("예시", e.example) : "") +
    (e.related.length ? sec("관련", e.related.map((r) => `- ${r}`).join("\n")) : "")
  ).trimEnd() + "\n";
}

const PARTICLES = /(?:으로|에서|에게|까지|부터|이나|를|을|은|는|이|가|의|에|도|로|와|과)$/;

/** Search forms of a query word: itself, plus a Korean particle-stripped stem ("한글을" also finds "한글"). */
export function forms(word: string): string[] {
  const stem = word.replace(PARTICLES, "");
  return stem.length >= 2 && stem !== word ? [word, stem] : [word];
}

/** Higher is a better match. Every query word must hit somewhere, so extra words narrow the list. */
export function score(e: PlaybookEntry, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const f of forms(w)) {
      let s = 0;
      if (e.title.toLowerCase().includes(f)) s += 3;
      if (e.tags.some((t) => t.toLowerCase().includes(f))) s += 3;
      if (e.symptom.toLowerCase().includes(f)) s += 2;
      if (e.cause.toLowerCase().includes(f) || e.fix.toLowerCase().includes(f)) s += 1;
      if (e.example.toLowerCase().includes(f)) s += 0.5;
      best = Math.max(best, s);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

function clean(s: unknown, max = MAX_FIELD): string {
  return typeof s === "string" ? s.slice(0, max).trim() : "";
}

export function sanitizeInput(raw: Partial<PlaybookInput> | undefined): PlaybookInput {
  const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120).trim()).filter(Boolean).slice(0, n) : []);
  const input: PlaybookInput = {
    title: clean(raw?.title, 120),
    tags: strs(raw?.tags, 12),
    symptom: clean(raw?.symptom),
    cause: clean(raw?.cause),
    fix: clean(raw?.fix),
    example: clean(raw?.example),
    related: strs(raw?.related, 12),
  };
  if (!input.title) throw new Error("제목이 필요합니다");
  if (!input.symptom || !input.fix) throw new Error("증상과 해결책은 필수입니다");
  return input;
}

export class PlaybookStore {
  constructor(
    private readonly dir: string,
    private readonly brain?: Brain,
  ) {}

  list(): PlaybookEntry[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
    } catch {
      return [];
    }
    const out: PlaybookEntry[] = [];
    for (const f of files) {
      try {
        const full = path.join(this.dir, f);
        out.push(parseEntry(f.slice(0, -3), fs.readFileSync(full, "utf8"), fs.statSync(full).mtimeMs));
      } catch {
        /* unreadable file: skip */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  search(query: string, limit = 20): PlaybookEntry[] {
    const q = query.trim();
    const scored = this.list()
      .map((e) => ({ e, s: score(e, q) }))
      .filter((x) => x.s > 0);
    if (q) scored.sort((a, b) => b.s - a.s || b.e.updatedAt - a.e.updatedAt);
    return scored.slice(0, limit).map((x) => x.e);
  }

  /** Create or (with `id`) overwrite an entry. A new title never clobbers an existing file. */
  save(raw: Partial<PlaybookInput> | undefined, id?: string): PlaybookEntry {
    const input = sanitizeInput(raw);
    fs.mkdirSync(this.dir, { recursive: true });
    let name = id && /^[a-z0-9가-힣-]{1,80}$/.test(id) ? id : slugify(input.title);
    if (!id) {
      const base = name;
      for (let n = 2; fs.existsSync(path.join(this.dir, `${name}.md`)); n++) name = `${base}-${n}`;
    }
    const full = path.join(this.dir, `${name}.md`);
    fs.writeFileSync(full, renderEntry(input), "utf8");
    return parseEntry(name, fs.readFileSync(full, "utf8"), fs.statSync(full).mtimeMs);
  }

  /** Draft an entry from a finished/failed work-log entry. The caller reviews it before saving. */
  async draftFrom(entry: WorkLogEntry): Promise<PlaybookInput> {
    const review = entry.reviews?.[entry.reviews.length - 1];
    const findings = review?.findings.map((f) => `[${f.severity}] ${f.issue}`).join("\n") ?? "";
    const facts = [`작업: ${entry.name}`, `폴더: ${entry.cwd}`, `결과: ${entry.summary}`, findings && `교차검증 지적:\n${findings}`, `출력 끝부분:\n${entry.tail.slice(-25).join("\n")}`].filter(Boolean).join("\n");
    const fallback: PlaybookInput = {
      title: entry.name.slice(0, 80),
      tags: [],
      symptom: entry.summary,
      cause: "",
      fix: "",
      example: entry.tail.slice(-8).join("\n"),
      related: [entry.cwd],
    };
    if (!this.brain || this.brain.kind === "heuristic") return fallback;
    const system = `개발 작업 기록에서 "난제 해결 사전" 항목 초안을 씁니다. 같은 문제를 다시 만났을 때 바로 찾아 쓸 수 있게, 증상은 검색에 걸릴 구체적 문구(에러 메시지, 현상)로 쓰세요. 기록에 없는 원인이나 해결을 지어내지 말고 모르면 빈 문자열로 두세요. 아래 JSON 하나만 출력: {"title":"","tags":[""],"symptom":"","cause":"","fix":"","example":"","related":[""]}`;
    const text = await this.brain.complete(system, [{ role: "user", content: facts.slice(0, 6000) }]);
    if (!text) return fallback;
    try {
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      const raw = JSON.parse(text.slice(a, b + 1)) as Partial<PlaybookInput>;
      return {
        title: clean(raw.title, 120) || fallback.title,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
        symptom: clean(raw.symptom) || fallback.symptom,
        cause: clean(raw.cause),
        fix: clean(raw.fix),
        example: clean(raw.example) || fallback.example,
        related: Array.isArray(raw.related) ? raw.related.filter((t): t is string => typeof t === "string").slice(0, 12) : fallback.related,
      };
    } catch {
      return fallback;
    }
  }
}
