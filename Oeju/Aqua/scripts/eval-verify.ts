// 2차 판정(CLIP) 평가. eval-detect.ts 의 DUMP 결과를 받아, 탐지 박스를 잘라 CLIP 으로 다시 본다.
//   npx vite-node -c vitest.config.ts scripts/eval-verify.ts -- <사진 폴더> <rows.json> [캐시.json]
// 캐시는 (사진, 박스, 문장)별 유사도라서 문장을 바꿔도 새 문장만 다시 부른다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { SPECIES_BY_ID, type ZoneId } from "@/data/species";
import { cosine, decide, VERIFY_RULES, verifyPrompts, type VerifyRules } from "@/lib/detection/verify";

const [dir, rowsPath, cachePath = rowsPath.replace(/\.json$/, "-clip.json")] = process.argv.slice(2).filter((a) => a !== "--");
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const key = env.ROBOFLOW_API_KEY;
const CLIP = process.env.CLIP_URL ?? "https://infer.roboflow.com/clip";

interface Row {
  file: string;
  truth: string | null;
  pred: string | null;
  ok: boolean | null;
  conf: number;
  box: [number, number, number, number];
}
const rows = (JSON.parse(readFileSync(rowsPath, "utf8")) as Row[]).filter((r) => r.ok !== null && r.pred);
const cache: Record<string, number[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

export async function cropBase64(file: string, box: Row["box"], margin = 1.3): Promise<string> {
  const img = sharp(join(dir, file)).rotate().resize({ width: 640, withoutEnlargement: true });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const [x, y, w, h] = box;
  const cw = Math.min(1, w * margin) * info.width;
  const ch = Math.min(1, h * margin) * info.height;
  const left = Math.max(0, Math.round(x * info.width - cw / 2));
  const top = Math.max(0, Math.round(y * info.height - ch / 2));
  const width = Math.max(8, Math.min(info.width - left, Math.round(cw)));
  const height = Math.max(8, Math.min(info.height - top, Math.round(ch)));
  const out = await sharp(data).extract({ left, top, width, height }).jpeg({ quality: 80 }).toBuffer();
  return out.toString("base64");
}

async function clip(path: string, body: unknown): Promise<number[][]> {
  const res = await fetch(`${CLIP}/${path}?api_key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CLIP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { embeddings: number[][] }).embeddings;
}

const text: Record<string, number[]> = (cache["__text"] as never) ?? {};
cache["__text"] = text as never;

async function similarity(row: Row, prompts: string[]): Promise<number[]> {
  const missing = prompts.filter((p) => !text[p]);
  if (missing.length) (await clip("embed_text", { text: missing })).forEach((e, i) => (text[missing[i]] = e));
  const k = `${row.file}|${row.box.map((v) => v.toFixed(3)).join(",")}`;
  if (!cache[k]) {
    const [e] = await clip("embed_image", { image: { type: "base64", value: await cropBase64(row.file, row.box) } });
    cache[k] = e as never;
  }
  const img = cache[k] as unknown as number[];
  return prompts.map((p) => cosine(img, text[p]));
}

function score(useZone: boolean, rules: VerifyRules, sims: Map<Row, number[]>) {
  const t = { goodKept: 0, goodLost: 0, badCaught: 0, badMissed: 0, corrected: 0, lost: [] as string[], missed: [] as string[] };
  for (const r of rows) {
    const zone: ZoneId | null = useZone && r.truth ? SPECIES_BY_ID[r.truth].zone : null;
    const prompts = verifyPrompts(zone);
    if (!prompts.speciesIds.includes(r.pred!)) continue; // 구역 필터가 이미 거른 답
    const all = verifyPrompts(null).prompts;
    const sim = prompts.prompts.map((p) => sims.get(r)![all.indexOf(p)]);
    const v = decide(sim, prompts, [r.pred!], rules);
    const rejected = v.kind === "none" || v.kind === "other";
    if (r.ok) {
      if (rejected) {
        t.goodLost++;
        t.lost.push(`${r.file}:${r.pred}->${v.kind === "other" ? v.speciesId : "none"}`);
      } else t.goodKept++;
    } else if (rejected) {
      t.badCaught++;
      if (v.kind === "other" && v.speciesId === r.truth) t.corrected++;
    } else {
      t.badMissed++;
      t.missed.push(`${r.file}:${r.pred}`);
    }
  }
  return t;
}

const sims = new Map<Row, number[]>();
for (const r of rows) sims.set(r, await similarity(r, verifyPrompts(null).prompts));
writeFileSync(cachePath, JSON.stringify(cache));

const grid: VerifyRules[] = process.env.SWEEP
  ? [0.3, 0.4, 0.5, 0.6, 0.7].flatMap((overturnP) => [1.5, 2, 3, 5].map((overturnRatio) => ({ overturnP, overturnRatio })))
  : [VERIFY_RULES];
for (const useZone of [false, true]) {
  console.log(`== CLIP 2차 판정 (${useZone ? "구역 후보" : "전체 후보"})`);
  for (const rules of grid) {
    const t = score(useZone, rules, sims);
    console.log(
      `  P>=${rules.overturnP} x${rules.overturnRatio}: 맞는 답 유지 ${t.goodKept} / 잘못 버림 ${t.goodLost} | 틀린 답 걸러냄 ${t.badCaught} (정답으로 고침 ${t.corrected}) / 못 거름 ${t.badMissed}`,
    );
    if (process.env.VERBOSE) {
      console.log("    잘못 버림:", t.lost.join(" "));
      console.log("    못 거름:", t.missed.join(" "));
    }
  }
}
