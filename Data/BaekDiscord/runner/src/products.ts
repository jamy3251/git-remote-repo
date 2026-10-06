import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Product, ProductHealth, ProductInsight, ProductMeta, ProductMetaPatch, ProductStage, WorkLogEntry } from "./protocol.js";
import type { Brain } from "./supervisor/brain.js";
import { SKIP, markersOf } from "./fsbrowse.js";
import { claudeTranscripts } from "./cliactivity.js";

const run = promisify(execFile);

export const WEEKS = 12;
const WEEK_MS = 7 * 24 * 3600_000;
const DAY_MS = 24 * 3600_000;
const SCAN_TTL_MS = 3 * 60_000;
const MAX_DEPTH = 3;
/** Markers that make a folder a project by themselves; git/claude alone may just be a container. */
const WEAK = new Set(["git", "claude", "readme"]);
const STAGES: ProductStage[] = ["idea", "building", "testing", "live", "maintain", "archived"];
const DEPLOY_RE = /https:\/\/[a-z0-9.-]+\.(?:vercel\.app|onrender\.com|netlify\.app|github\.io|pages\.dev|fly\.dev|up\.railway\.app|web\.app|firebaseapp\.com)(?:\/[^\s)"'<>\]]*)?/i;

const norm = (p: string) => path.resolve(p).toLowerCase();
const under = (dir: string, p: string) => {
  const d = norm(dir);
  const n = norm(p);
  return n === d || n.startsWith(d + path.sep);
};

function folderMarkers(dir: string): string[] {
  const m = markersOf(dir);
  if (fs.existsSync(path.join(dir, "README.md"))) m.push("readme");
  if (fs.existsSync(path.join(dir, "platformio.ini")) || hasFile(dir, ".ino")) m.push("arduino");
  return m;
}

function hasFile(dir: string, ext: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(ext));
  } catch {
    return false;
  }
}

function children(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith(".") && !SKIP.has(d.name))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/**
 * Project folders under `root`: a folder with a build/package marker is a product (we don't look
 * inside it); a folder with only weak markers (git, CLAUDE.md, README) is a product only when
 * nothing below it is. Category folders (App, Games, ...) have no markers and are walked through.
 */
export function discoverProducts(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): boolean => {
    const markers = depth === 0 ? [] : folderMarkers(dir);
    if (markers.some((m) => !WEAK.has(m))) {
      found.push(dir);
      return true;
    }
    let any = false;
    if (depth < MAX_DEPTH) for (const c of children(dir)) any = walk(c, depth + 1) || any;
    if (!any && markers.length > 0) {
      found.push(dir);
      return true;
    }
    return any;
  };
  walk(root, 0);
  return found.sort((a, b) => a.localeCompare(b));
}

/** Monday 00:00 (local) of each of the last `n` weeks, oldest first. */
export function weekStarts(now: number, n = WEEKS): number[] {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(d.getTime() - i * WEEK_MS);
  return out;
}

export function bucket(times: number[], weeks: number[]): number[] {
  const counts = weeks.map(() => 0);
  for (const t of times) {
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (t >= weeks[i]) {
        if (t < weeks[i] + WEEK_MS) counts[i] += 1;
        break;
      }
    }
  }
  return counts;
}

export function healthOf(lastActiveAt: number | null, now: number): ProductHealth {
  if (lastActiveAt === null || now - lastActiveAt > 30 * DAY_MS) return "dormant";
  return now - lastActiveAt > 7 * DAY_MS ? "slowing" : "active";
}

function days(ms: number): string {
  const d = Math.floor(ms / DAY_MS);
  return d <= 0 ? "오늘" : `${d}일`;
}

export function flagsOf(p: Pick<Product, "git" | "work" | "meta">, now: number): Product["flags"] {
  const flags: Product["flags"] = [];
  const g = p.git;
  if (g && g.dirty > 0) {
    const since = g.lastCommitAt ? now - g.lastCommitAt : null;
    if (since === null || since > 3 * DAY_MS) flags.push({ kind: "dirty", text: `미커밋 변경 ${g.dirty}개${since !== null ? ` · 마지막 커밋 ${days(since)} 전` : ""}` });
  }
  if (g && g.ahead > 0) flags.push({ kind: "unpushed", text: `푸시 안 한 커밋 ${g.ahead}개` });
  if (p.meta.ping && !p.meta.ping.ok) flags.push({ kind: "down", text: `배포 응답 없음${p.meta.ping.status ? ` (${p.meta.ping.status})` : ""}` });
  if (p.work.lastOutcome === "failed") flags.push({ kind: "failed", text: "마지막 작업 실패" });
  if (p.work.lastReview === "fail") flags.push({ kind: "review", text: "교차검증 수정 필요" });
  return flags;
}

function readmeInfo(dir: string): { description: string; url: string | null; head: string } {
  let text = "";
  try {
    text = fs.readFileSync(path.join(dir, "README.md"), "utf8").slice(0, 20_000);
  } catch {
    text = "";
  }
  const description =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^(#|!|\[|<|`|\||-{3}|>)/.test(l))
      ?.replace(/\*\*/g, "")
      .slice(0, 160) ?? "";
  return { description, url: text.match(DEPLOY_RE)?.[0] ?? null, head: text.slice(0, 1800) };
}

function packageHomepage(dir: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { homepage?: unknown };
    return typeof pkg.homepage === "string" && /^https:\/\//.test(pkg.homepage) ? pkg.homepage : null;
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" });
  return stdout;
}

/** Modification times of uncommitted files: work in progress counts as activity even before a commit. */
export function editTimes(repoRoot: string, porcelain: string, limit = 200): number[] {
  const out: number[] = [];
  for (const line of porcelain.split("\n")) {
    if (out.length >= limit) break;
    const rel = line.slice(3).trim().replace(/^"|"$/g, "");
    if (!rel || line.startsWith(" D") || line.startsWith("D ")) continue;
    const target = rel.includes(" -> ") ? rel.split(" -> ")[1] : rel;
    try {
      out.push(fs.statSync(path.join(repoRoot, target)).mtimeMs);
    } catch {
      /* vanished */
    }
  }
  return out;
}

async function gitInfo(dir: string, since: number): Promise<{ info: Product["git"]; commits: number[]; edits: number[] }> {
  try {
    const top = (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
    const [branch, last, log, status] = await Promise.all([
      git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).then((s) => s.trim()),
      git(dir, ["log", "-1", "--format=%ct%x1f%s", "--", "."]).catch(() => ""),
      git(dir, ["log", `--since=${Math.floor(since / 1000)}`, "--format=%ct", "--", "."]).catch(() => ""),
      git(dir, ["status", "--porcelain", "--untracked-files=normal", "--", "."]).catch(() => ""),
    ]);
    const ownRepo = norm(top) === norm(dir);
    let ahead = 0;
    if (ownRepo) ahead = Number((await git(dir, ["rev-list", "--count", "@{upstream}..HEAD"]).catch(() => "0")).trim()) || 0;
    const [ct, subject] = last.trim().split("\x1f");
    return {
      info: {
        ownRepo,
        branch,
        lastCommitAt: ct ? Number(ct) * 1000 : null,
        lastCommit: (subject ?? "").slice(0, 120),
        dirty: status.split("\n").filter((l) => l.trim()).length,
        ahead,
      },
      commits: log
        .split("\n")
        .filter(Boolean)
        .map((s) => Number(s) * 1000),
      edits: editTimes(top, status),
    };
  } catch {
    return { info: null, commits: [], edits: [] };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const emptyMeta = (): ProductMeta => ({ stage: null, note: "", hidden: false, pinned: false, deployUrl: null, insight: null, ping: null });

const INSIGHT_SYSTEM = `당신은 1인 개발자가 여러 개 굴리는 프로덕트(사이드 프로젝트·앱·과제)를 관리해 주는 보조입니다.
한 프로덕트의 README 앞부분, 최근 커밋, 미커밋 변경, 최근 작업 결과, 사용자 메모를 보고 지금 상태와 다음에 할 일을 정리합니다.
- status: 지금 어디까지 왔는지 한 문장(한국어).
- next: 바로 할 수 있는 구체적 행동 3개 이하(파일·명령 수준으로 구체적으로). 사용자가 정한 단계에 맞게.
- risks: 방치되면 문제가 될 것(미커밋 변경, 배포 다운, 만료 마감 등) 2개 이하. 없으면 빈 배열.
추측은 "~로 보임". 반드시 JSON 하나만: {"status":"...","next":["..."],"risks":["..."]}`;

/**
 * The product portfolio: discovery, per-product git/Claude/work-log activity, user metadata,
 * on-demand AI check-ups and deploy pings. Scans are cached for a few minutes.
 */
export class ProductStore {
  private meta: Record<string, ProductMeta> = {};
  private cache: { at: number; products: Product[]; weeks: number[] } | null = null;
  private scanning: Promise<{ products: Product[]; weeks: number[]; scannedAt: number }> | null = null;

  constructor(
    private root: string,
    private metaFile: string,
    private deps: { worklog: () => WorkLogEntry[]; brain: Brain },
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Record<string, Partial<ProductMeta>>;
      for (const [k, v] of Object.entries(raw)) this.meta[k] = { ...emptyMeta(), ...v };
    } catch {
      this.meta = {};
    }
  }

  private key(p: string): string {
    return path.relative(this.root, p).replace(/\\/g, "/");
  }

  metaOf(p: string): ProductMeta {
    return this.meta[this.key(p)] ?? emptyMeta();
  }

  private saveMeta(): void {
    fs.mkdirSync(path.dirname(this.metaFile), { recursive: true });
    const tmp = `${this.metaFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.meta, null, 2));
    fs.renameSync(tmp, this.metaFile);
  }

  private setMeta(p: string, patch: Partial<ProductMeta>): ProductMeta {
    const k = this.key(p);
    this.meta[k] = { ...emptyMeta(), ...this.meta[k], ...patch };
    this.saveMeta();
    return this.meta[k];
  }

  async list(force = false): Promise<{ products: Product[]; weeks: number[]; scannedAt: number }> {
    if (!force && this.cache && Date.now() - this.cache.at < SCAN_TTL_MS) return { products: this.withMeta(this.cache.products), weeks: this.cache.weeks, scannedAt: this.cache.at };
    if (!this.scanning) this.scanning = this.scan().finally(() => (this.scanning = null));
    return this.scanning;
  }

  /** Re-apply current metadata (stage, ping, insight) to cached scan results. */
  private withMeta(products: Product[]): Product[] {
    const now = Date.now();
    return products.map((p) => {
      const meta = this.metaOf(p.path);
      const next = { ...p, meta, deployUrl: meta.deployUrl ?? p.deployUrl };
      return { ...next, flags: flagsOf(next, now) };
    });
  }

  private async scan(): Promise<{ products: Product[]; weeks: number[]; scannedAt: number }> {
    const now = Date.now();
    const weeks = weekStarts(now);
    const paths = discoverProducts(this.root);
    const transcripts = claudeTranscripts();
    const log = this.deps.worklog();
    const products = await pool(paths, 4, async (dir): Promise<Product> => {
      const { info, commits, edits } = await gitInfo(dir, weeks[0]);
      // One activity per day of uncommitted edits, so a big refactor doesn't swamp the heatmap.
      const editDays = [...new Set(edits.map((t) => Math.floor(t / DAY_MS)))].map((d) => d * DAY_MS + DAY_MS / 2);
      const lastEdit = edits.length ? Math.max(...edits) : 0;
      const talks = transcripts.filter((t) => under(dir, t.cwd)).map((t) => t.at);
      const claudeAt = talks.length ? Math.max(...talks) : null;
      const work = log.filter((e) => under(dir, e.cwd));
      const lastWork = work[0];
      const lastReview = lastWork?.reviews?.[lastWork.reviews.length - 1];
      const readme = readmeInfo(dir);
      const meta = this.metaOf(dir);
      const activityTimes = [...commits, ...talks, ...work.map((e) => e.endedAt), ...editDays];
      const lastActiveAt = Math.max(info?.lastCommitAt ?? 0, claudeAt ?? 0, lastWork?.endedAt ?? 0, lastEdit) || null;
      const rel = path.relative(this.root, dir).split(path.sep);
      const base: Omit<Product, "flags"> = {
        path: dir,
        name: path.basename(dir),
        category: rel.length > 1 ? rel[0] : "",
        markers: folderMarkers(dir).filter((m) => m !== "readme"),
        description: readme.description,
        deployUrl: meta.deployUrl ?? packageHomepage(dir) ?? readme.url,
        git: info,
        claudeAt,
        activity: bucket(activityTimes, weeks),
        lastActiveAt,
        health: healthOf(lastActiveAt, now),
        work: {
          count: work.length,
          lastAt: lastWork?.endedAt ?? null,
          lastOutcome: lastWork ? (lastWork.status === "exited" && lastWork.exitCode === 0 ? "ok" : lastWork.status === "killed" ? "killed" : "failed") : null,
          lastReview: lastReview?.verdict ?? null,
        },
        meta,
      };
      return { ...base, flags: flagsOf(base, now) };
    });
    this.cache = { at: now, products, weeks };
    return { products, weeks, scannedAt: now };
  }

  private async find(p: string): Promise<Product> {
    const { products } = await this.list();
    const hit = products.find((x) => norm(x.path) === norm(p));
    if (!hit) throw new Error(`프로덕트를 찾을 수 없습니다: ${p}`);
    return hit;
  }

  async update(p: string, patch: ProductMetaPatch): Promise<Product> {
    await this.find(p);
    const clean: Partial<ProductMeta> = {};
    if (patch.stage === null || (patch.stage && STAGES.includes(patch.stage))) clean.stage = patch.stage;
    if (typeof patch.note === "string") clean.note = patch.note.slice(0, 2000);
    if (typeof patch.hidden === "boolean") clean.hidden = patch.hidden;
    if (typeof patch.pinned === "boolean") clean.pinned = patch.pinned;
    if (patch.deployUrl === null || (typeof patch.deployUrl === "string" && /^https?:\/\/\S+$/.test(patch.deployUrl.trim()))) clean.deployUrl = patch.deployUrl?.trim() || null;
    this.setMeta(p, clean);
    return this.find(p);
  }

  /** HTTP GET the deploy URL (6s timeout) and remember whether it answered. */
  async ping(p: string): Promise<Product> {
    const prod = await this.find(p);
    if (!prod.deployUrl) throw new Error("배포 주소가 없습니다. 카드에서 주소를 넣어 주세요");
    const start = Date.now();
    let result: ProductMeta["ping"];
    try {
      const res = await fetch(prod.deployUrl, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
      result = { at: Date.now(), ok: res.status < 500, status: res.status, ms: Date.now() - start, error: null };
    } catch (e) {
      result = { at: Date.now(), ok: false, status: null, ms: null, error: (e as Error).message.slice(0, 120) };
    }
    this.setMeta(p, { ping: result });
    return this.find(p);
  }

  /** Ask the prompt model where the product stands and what to do next. */
  async insight(p: string): Promise<Product> {
    const prod = await this.find(p);
    const readme = readmeInfo(prod.path);
    const [log, status] = await Promise.all([
      git(prod.path, ["log", "-8", "--format=%cr%x09%s", "--", "."]).catch(() => ""),
      git(prod.path, ["status", "--porcelain", "--", "."]).catch(() => ""),
    ]);
    const work = this.deps
      .worklog()
      .filter((e) => under(prod.path, e.cwd))
      .slice(0, 5)
      .map((e) => `- ${e.name}: ${e.summary.slice(0, 160)}${e.reviews?.length ? ` (교차검증 ${e.reviews[e.reviews.length - 1].verdict ?? "진행"})` : ""}`);
    let insight: ProductInsight;
    const fallback = (): ProductInsight => ({
      at: Date.now(),
      status: prod.git?.lastCommit ? `마지막 커밋: ${prod.git.lastCommit}` : "커밋 기록 없음",
      next: prod.flags.map((f) => (f.kind === "dirty" ? "미커밋 변경을 정리해 커밋하거나 버리기" : f.kind === "unpushed" ? "원격에 푸시하기" : f.kind === "down" ? "배포 상태 확인하기" : "마지막 작업 결과 확인하기")).slice(0, 3),
      risks: prod.flags.map((f) => f.text).slice(0, 2),
      source: "heuristic",
    });
    if (this.deps.brain.kind === "heuristic") insight = fallback();
    else {
      const user = [
        `프로덕트: ${prod.name} (${prod.category || "루트"}) · ${prod.path}`,
        `사용자가 정한 단계: ${prod.meta.stage ?? "미정"}${prod.meta.note ? ` · 메모: ${prod.meta.note}` : ""}`,
        `상태: ${prod.health} · 배포 ${prod.deployUrl ?? "없음"}${prod.meta.ping ? ` (${prod.meta.ping.ok ? "응답" : "응답 없음"})` : ""}`,
        `손볼 것: ${prod.flags.map((f) => f.text).join(", ") || "없음"}`,
        "",
        "최근 커밋:",
        log.trim() || "(없음)",
        "",
        "미커밋 변경:",
        status.split("\n").filter(Boolean).slice(0, 15).join("\n") || "(없음)",
        "",
        "최근 작업 내역:",
        work.join("\n") || "(없음)",
        "",
        "README 앞부분:",
        readme.head || "(README 없음)",
      ].join("\n");
      const out = await this.deps.brain.complete(INSIGHT_SYSTEM, [{ role: "user", content: user }]);
      const start = out?.indexOf("{") ?? -1;
      const end = out?.lastIndexOf("}") ?? -1;
      try {
        if (!out || start < 0 || end <= start) throw new Error("no json");
        const j = JSON.parse(out.slice(start, end + 1)) as { status?: unknown; next?: unknown; risks?: unknown };
        const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 240)).slice(0, n) : []);
        insight = { at: Date.now(), status: typeof j.status === "string" ? j.status.slice(0, 300) : "", next: list(j.next, 3), risks: list(j.risks, 2), source: "brain" };
      } catch {
        insight = fallback();
      }
    }
    this.setMeta(p, { insight });
    return this.find(p);
  }
}
