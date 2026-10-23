import { labelKey, type Detection } from "./types";

export const MERGE_IOU = 0.45;

const RANK = { species: 2, group: 1, unknown: 0 } as const;

export function iou(a: Detection, b: Detection): number {
  const ax1 = a.x - a.w / 2;
  const ay1 = a.y - a.h / 2;
  const bx1 = b.x - b.w / 2;
  const by1 = b.y - b.h / 2;
  const ix = Math.max(0, Math.min(ax1 + a.w, bx1 + b.w) - Math.max(ax1, bx1));
  const iy = Math.max(0, Math.min(ay1 + a.h, by1 + b.h) - Math.max(ay1, by1));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * 여러 모델 결과를 합친다. 같은 물체에 박스가 겹치면 하나만 남기는데,
 * 확신도보다 "얼마나 구체적인 라벨인가"를 먼저 본다.
 * (보조 모델의 shark 0.9 보다 메인 모델의 Zebra_shark 0.6 이 도감에 쓸모 있다)
 */
export function mergeDetections(lists: Detection[][], threshold = MERGE_IOU): Detection[] {
  const all = lists.flat().sort((a, b) => {
    const r = RANK[b.label.kind] - RANK[a.label.kind];
    return r !== 0 ? r : b.confidence - a.confidence;
  });
  const kept: Detection[] = [];
  for (const d of all) {
    const twin = kept.find((k) => iou(k, d) >= threshold);
    if (!twin) {
      kept.push({ ...d, agree: 1 });
      continue;
    }
    // 겹쳐서 버려지는 박스도 "다른 모델의 의견"으로 남긴다
    if (d.model === twin.model) continue;
    if (labelKey(d.label) === labelKey(twin.label)) twin.agree = (twin.agree ?? 1) + 1;
    else if (d.label.kind === "species") twin.contested = [...(twin.contested ?? []), d.label.speciesId];
  }
  return kept.sort((a, b) => b.confidence - a.confidence);
}
