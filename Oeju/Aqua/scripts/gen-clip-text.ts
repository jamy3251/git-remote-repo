// 2차 판정용 문장 특징(CLIP 텍스트 임베딩)을 미리 만들어 둔다. 문장(verify.ts)을 바꾸면 다시 실행.
//   npx vite-node -c vitest.config.ts scripts/gen-clip-text.ts
import { readFileSync, writeFileSync } from "node:fs";
import { CLIP_MODEL, verifyPrompts } from "@/lib/detection/verify";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const base = (env.ROBOFLOW_CLIP_URL || "https://infer.roboflow.com/clip").replace(/\/+$/, "");
const { prompts } = verifyPrompts(null);

const res = await fetch(`${base}/embed_text?api_key=${env.ROBOFLOW_API_KEY}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: prompts }),
});
if (!res.ok) throw new Error(`CLIP ${res.status} ${await res.text()}`);
const body = (await res.json()) as { embeddings: number[][]; resolved_model?: { model_id?: string } };
const model = body.resolved_model?.model_id ?? CLIP_MODEL;
if (model !== CLIP_MODEL) throw new Error(`모델이 다릅니다: ${model} (verify.ts 의 CLIP_MODEL 과 맞추세요)`);

const out = {
  model,
  generatedAt: new Date().toISOString().slice(0, 10),
  vectors: Object.fromEntries(prompts.map((p, i) => [p, body.embeddings[i].map((v) => Math.round(v * 1e5) / 1e5)])),
};
writeFileSync("src/data/clip-text.json", JSON.stringify(out));
console.log(`문장 ${prompts.length}개, 모델 ${model}`);
