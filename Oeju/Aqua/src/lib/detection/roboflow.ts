import { mapClass } from "./classMap";
import { mergeDetections } from "./merge";
import { RECOMMENDED_MODELS } from "./models";
import type { Detection, ModelRun } from "./types";

export interface RoboflowConfig {
  apiKey: string;
  /** "project/version" 목록, 예: aquarium-xj7ov/5 */
  models: string[];
  baseUrl: string;
  confidence: number;
}

interface RoboflowPrediction {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

interface RoboflowResponse {
  image?: { width: number; height: number };
  predictions?: RoboflowPrediction[];
}

type Env = Record<string, string | undefined>;

export function readRoboflowConfig(env: Env = process.env): RoboflowConfig | null {
  const apiKey = env.ROBOFLOW_API_KEY?.trim();
  if (!apiKey) return null;
  // ROBOFLOW_MODEL_ID 는 v0.1 호환용
  const listed = (env.ROBOFLOW_MODELS ?? env.ROBOFLOW_MODEL_ID ?? "")
    .split(",")
    .map((m) => m.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return {
    apiKey,
    models: listed.length ? [...new Set(listed)] : RECOMMENDED_MODELS.map((m) => m.id),
    baseUrl: (env.ROBOFLOW_API_URL?.trim() || "https://serverless.roboflow.com").replace(/\/+$/, ""),
    confidence: Number(env.ROBOFLOW_CONFIDENCE?.trim() || 35),
  };
}

/** 픽셀 좌표 응답을 0~1 정규화 + 도감 라벨로 변환 */
export function parseRoboflow(
  body: RoboflowResponse,
  sent: { width: number; height: number },
  model?: string,
): Detection[] {
  const width = body.image?.width || sent.width;
  const height = body.image?.height || sent.height;
  if (!width || !height) return [];

  return (body.predictions ?? [])
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.width > 0 && p.height > 0)
    .map((p) => ({
      x: clamp01(p.x / width),
      y: clamp01(p.y / height),
      w: clamp01(p.width / width),
      h: clamp01(p.height / height),
      confidence: clamp01(p.confidence),
      rawClass: p.class,
      label: mapClass(p.class),
      model,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export async function detectWithModel(
  config: RoboflowConfig,
  model: string,
  imageBase64: string,
  sent: { width: number; height: number },
  signal?: AbortSignal,
): Promise<Detection[]> {
  const url = new URL(`${config.baseUrl}/${model}`);
  url.searchParams.set("api_key", config.apiKey);
  // 서버측 하한선. 최종 포획 판단은 클라이언트 조준 추적기가 한다.
  url.searchParams.set("confidence", String(config.confidence));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: imageBase64,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Roboflow ${model} ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseRoboflow((await res.json()) as RoboflowResponse, sent, model);
}

type Detector = (model: string) => Promise<Detection[]>;

/**
 * 모든 모델을 동시에 부르고 겹치는 박스를 합친다.
 * 일부 모델만 실패하면 나머지 결과로 계속 간다. 전부 실패할 때만 throw.
 */
export async function detectWithModels(
  models: string[],
  detect: Detector,
  /** 병합 전에 모델별 결과에 적용 (구역 필터 등) */
  refine: (d: Detection[]) => Detection[] = (d) => d,
): Promise<{ detections: Detection[]; runs: ModelRun[]; perModel: { model: string; detections: Detection[] }[] }> {
  const results = await Promise.all(
    models.map(async (model) => {
      const started = Date.now();
      try {
        const detections = refine(await detect(model));
        return { run: { model, ok: true, ms: Date.now() - started }, detections };
      } catch (err) {
        console.error("[detect]", err);
        return { run: { model, ok: false, ms: Date.now() - started }, detections: [] as Detection[] };
      }
    }),
  );
  const runs = results.map((r) => r.run);
  if (runs.every((r) => !r.ok)) throw new Error("all models failed");
  return {
    detections: mergeDetections(results.map((r) => r.detections)),
    runs,
    perModel: results.map((r) => ({ model: r.run.model, detections: r.detections })),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
