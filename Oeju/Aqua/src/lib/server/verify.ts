import clipText from "@/data/clip-text.json";
import type { ZoneId } from "@/data/species";
import { CLIP_MODEL, cosine, decide, verifyPrompts, type Verdict } from "@/lib/detection/verify";

type Env = Record<string, string | undefined>;

export interface VerifyCrop {
  /** base64 JPEG, 접두어 없음 */
  image: string;
  /** 1차 답. 무리 단위면 후보 종 여러 개 */
  predicted: string[];
}

const VECTORS = (clipText as { vectors: Record<string, number[]> }).vectors;

export function clipBaseUrl(env: Env = process.env): string {
  return (env.ROBOFLOW_CLIP_URL?.trim() || "https://infer.roboflow.com/clip").replace(/\/+$/, "");
}

/** 미리 만든 문장 특징과 사진 특징을 비교해 판정. 실패하면 판단 보류(1차 답 유지) */
export async function verifyCrops(
  crops: VerifyCrop[],
  zone: ZoneId | null,
  opts: { apiKey: string; baseUrl: string; timeoutMs?: number; fetch?: typeof fetch },
): Promise<Verdict[]> {
  const prompts = verifyPrompts(zone);
  const text = prompts.prompts.map((p) => VECTORS[p]);
  if (text.some((v) => !v)) throw new Error("clip-text.json 이 문장과 맞지 않습니다. scripts/gen-clip-text.ts 를 다시 실행하세요.");
  const doFetch = opts.fetch ?? fetch;

  return Promise.all(
    crops.map(async (crop): Promise<Verdict> => {
      try {
        const res = await doFetch(`${opts.baseUrl}/embed_image?api_key=${encodeURIComponent(opts.apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: { type: "base64", value: crop.image } }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
        });
        if (!res.ok) throw new Error(`CLIP ${res.status}`);
        const body = (await res.json()) as { embeddings?: number[][]; resolved_model?: { model_id?: string } };
        const image = body.embeddings?.[0];
        const model = body.resolved_model?.model_id;
        if (!image || (model && model !== CLIP_MODEL)) throw new Error(`CLIP 응답 이상 (${model})`);
        return decide(
          text.map((t) => cosine(image, t)),
          prompts,
          crop.predicted,
        );
      } catch (err) {
        console.error("[verify]", err);
        return { kind: "unsure" };
      }
    }),
  );
}
