import type { ZoneId } from "@/data/species";
import { mergeDetections } from "./merge";
import type { Detection, Label } from "./types";
import { restrictToZone } from "./zone";

/** 포획 기준 확신도 기본값 */
export const BASE_CAPTURE_CONF = 0.5;

/**
 * 모델이 모르는 것을 자주 떠넘기는 종 ("기타 칸" 역할).
 * 2026-10-19 평가(scripts/eval-detect.ts)에서 틀린 답이 맞는 답만큼 나온 종 + 현장 영상 시험에서 보고된 종.
 */
export const SUSPECT_SPECIES = new Set([
  "clownfish",
  "black-stingray",
  "napoleon-wrasse",
  "green-sea-turtle",
  "butterflyfish",
  "giant-grouper",
  "silver-arowana",
]);
export const SUSPECT_CAPTURE_CONF = 0.7;

/** 화면 대부분을 덮는 박스: 모니터·유리 반사·배경 전체를 물고기로 본 경우가 많다 */
export const HUGE_BOX_AREA = 0.6;
const HUGE_BOX_PENALTY = 0.75;
/** 같은 자리에서 다른 모델이 다른 종이라고 하면 깎는다 */
const CONTESTED_PENALTY = 0.8;

export function captureThreshold(label: Label, base = BASE_CAPTURE_CONF): number {
  if (label.kind === "species" && SUSPECT_SPECIES.has(label.speciesId)) return Math.max(base, SUSPECT_CAPTURE_CONF);
  return base;
}

/** 실시간 1단계 거름: 모양·모델 간 의견으로 확신도를 보정한다 */
export function guard(detections: Detection[]): Detection[] {
  return detections.map((d) => {
    let factor = 1;
    if (d.w * d.h > HUGE_BOX_AREA && (d.agree ?? 1) < 2) factor *= HUGE_BOX_PENALTY;
    if (d.contested?.length) factor *= CONTESTED_PENALTY;
    return factor === 1 ? d : { ...d, confidence: d.confidence * factor };
  });
}

export interface PostProcessOptions {
  zone: ZoneId | null;
  guard: boolean;
}

/** 모델별 원본 결과 → 화면에 보낼 최종 탐지. 서버와 평가 도구가 같은 함수를 쓴다. */
export function postProcess(
  perModel: { model: string; detections: Detection[] }[],
  opts: PostProcessOptions,
): { detections: Detection[]; perModel: { model: string; detections: Detection[] }[] } {
  // 구역 필터는 병합 전에 건다: 구역 밖 오답이 맞는 답을 겹침 제거로 지우지 않게.
  const refined = perModel.map((m) => ({ model: m.model, detections: restrictToZone(m.detections, opts.zone) }));
  const merged = mergeDetections(refined.map((m) => m.detections));
  return { detections: opts.guard ? guard(merged) : merged, perModel: refined };
}
