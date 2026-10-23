// 인식 평가 도구 (0단계 측정).
//   npx vite-node -c vitest.config.ts scripts/eval-detect.ts -- <사진 폴더> [캐시.json]
// 파일 이름 규칙: <정답 종 id>__N.jpg, 도감에 없는 것은 neg-<무엇>__N.jpg
// 모델 응답은 캐시에 저장해 두고, 규칙만 바꿔 다시 채점할 때는 모델을 다시 부르지 않는다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { SPECIES_BY_ID } from "@/data/species";
import { parseRoboflow, readRoboflowConfig } from "@/lib/detection/roboflow";
import { scoreFrames, type EvalFrame } from "@/lib/detection/evaluate";

const [dir, cachePath = join(dir ?? ".", "_cache.json")] = process.argv.slice(2).filter((a) => a !== "--");
if (!dir) throw new Error("사진 폴더를 지정하세요");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const config = readRoboflowConfig(env);
if (!config) throw new Error("ROBOFLOW_API_KEY 없음");

type Cache = Record<string, { width: number; height: number; models: Record<string, unknown> }>;
const cache: Cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
let called = 0;
for (const f of files) {
  if (cache[f] && config.models.every((m) => m in cache[f].models)) continue;
  // 앱과 같은 조건: 가로 640, JPEG 품질 72
  const img = sharp(join(dir, f)).rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 72 });
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const entry = (cache[f] ??= { width: info.width, height: info.height, models: {} });
  await Promise.all(
    config.models.map(async (m) => {
      const url = `${config.baseUrl}/${m}?api_key=${config.apiKey}&confidence=${config.confidence}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: data.toString("base64"),
      });
      if (res.ok) entry.models[m] = await res.json();
    }),
  );
  called++;
  if (called % 10 === 0) writeFileSync(cachePath, JSON.stringify(cache));
}
writeFileSync(cachePath, JSON.stringify(cache));

const frames: EvalFrame[] = Object.entries(cache)
  .filter(([f]) => files.includes(f))
  .map(([f, e]) => {
    const truth = f.split("__")[0];
    return {
      file: f,
      truth: SPECIES_BY_ID[truth] ? truth : null,
      perModel: config.models.map((m) => ({
        model: m,
        detections: e.models[m] ? parseRoboflow(e.models[m] as never, e, m) : [],
      })),
    };
  });

if (process.env.DUMP) {
  // 규칙 설계용: 병합 후 탐지 하나하나를 정답 여부와 함께 저장
  const { postProcess } = await import("@/lib/detection/pipeline");
  const rows = frames.flatMap((f) =>
    postProcess(f.perModel, { zone: null, guard: false }).detections.map((d) => ({
      file: f.file,
      truth: f.truth,
      pred: d.label.kind === "species" ? d.label.speciesId : d.label.kind === "group" ? d.label.group : null,
      ok: d.label.kind === "species" ? d.label.speciesId === f.truth : null,
      conf: d.confidence,
      area: d.w * d.h,
      aspect: d.w / d.h,
      box: [d.x, d.y, d.w, d.h],
      agree: d.agree,
      contested: d.contested ?? [],
      model: d.model,
      raw: d.rawClass,
    })),
  );
  writeFileSync(process.env.DUMP, JSON.stringify(rows));
}

const variants = (process.env.VARIANTS ?? "baseline,zone,guard,guard+zone").split(",");
console.log(`사진 ${frames.length}장 (정답 있음 ${frames.filter((f) => f.truth).length}, 도감 밖 ${frames.filter((f) => !f.truth).length}), 새로 호출 ${called}장\n`);
for (const v of variants) {
  const r = scoreFrames(frames, { guard: v.includes("guard"), zone: v.includes("zone") });
  console.log(`== ${v}`);
  console.log(
    `  도감 종: 맞음 ${r.correct} / 틀림 ${r.wrong} / 놓침 ${r.missed}  (정확 ${pct(r.correct, r.correct + r.wrong)}, 재현 ${pct(r.correct, r.positives)})`,
  );
  console.log(`  도감 밖 사진에서 헛인식 ${r.falseOnNeg} / ${r.negatives}`);
  console.log(`  틀린 답으로 많이 나온 종: ${r.wrongBy.map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
  if (process.env.VERBOSE) for (const line of r.errors) console.log("   ", line);
}

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "-";
}
