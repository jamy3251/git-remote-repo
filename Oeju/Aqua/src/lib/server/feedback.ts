import type { ZoneId } from "@/data/species";

export type FeedbackKind = "misid" | "field";

export interface FeedbackMeta {
  kind: FeedbackKind;
  zone: ZoneId | null;
  predicted?: string | null;
  rawClass?: string | null;
  model?: string | null;
  confidence?: number | null;
  /** 사용자가 고른 실제 종. 도감에 없는 생물이면 "none" */
  actual?: string | null;
  /** 2차 판정(CLIP) 결과: match | other | none | unsure */
  clip?: string | null;
}

/** Roboflow 태그는 짧고 단순하게: 검색·필터용 */
export function feedbackTags(meta: FeedbackMeta): string[] {
  const clean = (s: string) => s.replace(/[^\w\-./]+/g, "_").slice(0, 60);
  const tags = [`kind:${meta.kind}`, "source:coex-aqua-dex"];
  if (meta.zone) tags.push(`zone:${meta.zone}`);
  if (meta.rawClass) tags.push(`pred:${clean(meta.rawClass)}`);
  if (meta.model) tags.push(`model:${clean(meta.model)}`);
  if (typeof meta.confidence === "number") tags.push(`conf:${Math.round(meta.confidence * 100)}`);
  if (meta.actual) tags.push(`actual:${clean(meta.actual)}`);
  if (meta.clip) tags.push(`clip:${clean(meta.clip)}`);
  return tags;
}

export function feedbackName(meta: FeedbackMeta, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const rand = Math.random().toString(36).slice(2, 7);
  return `${meta.kind}-${meta.zone ?? "nozone"}-${stamp}-${rand}.jpg`;
}

export function feedbackBatch(meta: FeedbackMeta, now = new Date()): string {
  return `${meta.kind}-${now.toISOString().slice(0, 10)}`;
}

export interface UploadResult {
  id: string | null;
  duplicate: boolean;
}

export async function uploadToRoboflow(
  opts: { apiKey: string; project: string; baseUrl?: string },
  imageBase64: string,
  meta: FeedbackMeta,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const url = new URL(`${opts.baseUrl ?? "https://api.roboflow.com"}/dataset/${opts.project}/upload`);
  url.searchParams.set("api_key", opts.apiKey);
  url.searchParams.set("name", feedbackName(meta));
  url.searchParams.set("split", "train");
  url.searchParams.set("batch", feedbackBatch(meta));
  for (const t of feedbackTags(meta)) url.searchParams.append("tag", t);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: imageBase64,
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Roboflow upload ${res.status}: ${text.slice(0, 200)}`);
  let body: { id?: string; duplicate?: boolean; success?: boolean } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (body.success === false) throw new Error(`Roboflow upload rejected: ${text.slice(0, 200)}`);
  return { id: body.id ?? null, duplicate: !!body.duplicate };
}

export function readFeedbackProject(env: Record<string, string | undefined> = process.env): string | null {
  return env.ROBOFLOW_FEEDBACK_PROJECT?.trim().replace(/^.*\//, "") || null;
}
