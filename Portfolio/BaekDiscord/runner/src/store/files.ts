import fs from "node:fs";
import path from "node:path";

/** Files above this size are rotated to `<file>.1` when a log is opened (only one old copy kept). */
export const ROTATE_BYTES = 5 * 1024 * 1024;

export interface ReadResult<T> {
  records: T[];
  /** Lines that were not valid JSON (e.g. the last line cut off by a crash mid-write). */
  skipped: number;
}

/** Read a jsonl file, skipping broken lines. A missing file is an empty log. */
export function readJsonl<T>(file: string): ReadResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { records: [], skipped: 0 };
    throw e;
  }
  const records: T[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t) as T);
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

/**
 * Append-only jsonl log. `rotate: false` keeps the file forever (decision records are the eval's
 * golden set, so they are never rotated away).
 */
export class JsonlLog<T> {
  constructor(
    readonly file: string,
    private opts: { rotate: boolean; onSkipped?: (n: number) => void } = { rotate: true },
  ) {}

  /** Call once at startup: rotates an oversized file, then reads what is there. */
  open(): T[] {
    if (this.opts.rotate) {
      try {
        if (fs.statSync(this.file).size > ROTATE_BYTES) fs.renameSync(this.file, `${this.file}.1`);
      } catch {
        /* missing file: nothing to rotate */
      }
    }
    const { records, skipped } = readJsonl<T>(this.file);
    if (skipped) this.opts.onSkipped?.(skipped);
    return records;
  }

  /** Throws on failure so the caller can report it; nothing here swallows write errors. */
  append(record: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }
}

/**
 * Write a JSON document atomically: temp file, then rename over the target. On Windows the rename
 * fails with EPERM/EBUSY while another process (antivirus, indexer) holds the file, so retry.
 */
export function writeJsonAtomic(file: string, value: unknown, opts: { retries?: number; rename?: (a: string, b: string) => void; sleep?: (ms: number) => void } = {}): void {
  const retries = opts.retries ?? 3;
  const rename = opts.rename ?? fs.renameSync;
  const sleep = opts.sleep ?? ((ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      rename(tmp, file);
      return;
    } catch (e) {
      last = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      if (attempt < retries) sleep(50 * (attempt + 1));
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw last;
}
