import type { Verification } from "./collection";
import type { Label } from "./detection/types";
import type { Verdict } from "./detection/verify";

/** 셔터 한 번에 잡힌 한 마리 */
export interface BatchItem {
  id: number;
  label: Extract<Label, { kind: "species" | "group" }>;
  /** 1차 답 후보 종 (종 단위면 하나, 무리 단위면 여러 개) */
  predicted: string[];
  photo: string | null;
  /** 학습용으로 크게 자른 사진 (base64, 접두어 없음) */
  trainingImage: string | null;
  /** 2차 판정용 작은 사진 */
  verifyImage: string | null;
  confidence: number;
  rawClass: string;
  model: string | null;
  verdict: Verdict | "pending";
  /** 사용자가 고른 종. null = 포획 안 함 */
  choice: string | null;
  /** 사용자가 직접 바꿨으면 2차 판정이 덮어쓰지 않는다 */
  touched: boolean;
}

// 셔터 한 번에 여러 마리를 잡을 때의 규칙 (화면과 분리해 시험 가능하게)

export const COMBO_STEP = 0.2;
export const MAX_COMBO = 1.6;

/** 한 번에 여러 종을 잡으면 경험치를 더 준다: 2마리 x1.2, 3마리 x1.4, 4마리 x1.6 */
export function comboBonus(distinctSpecies: number): number {
  return Math.min(MAX_COMBO, 1 + COMBO_STEP * Math.max(0, distinctSpecies - 1));
}

/** 처음 보여줄 선택: 종 단위면 그 종, 무리 단위는 후보가 하나일 때만 */
export function initialChoice(predicted: string[]): string | null {
  return predicted.length === 1 ? predicted[0] : null;
}

/** 2차 판정이 도착했을 때. 사용자가 이미 고친 항목은 판정만 기록한다 */
export function applyVerdict(item: BatchItem, verdict: Verdict): BatchItem {
  if (item.touched) return { ...item, verdict };
  if (verdict.kind === "other") return { ...item, verdict, choice: verdict.speciesId };
  if (verdict.kind === "none") return { ...item, verdict, choice: null };
  return { ...item, verdict };
}

export function pick(item: BatchItem, choice: string | null): BatchItem {
  return { ...item, choice, touched: true };
}

export interface BatchPlan {
  saves: { item: BatchItem; speciesId: string; verifiedBy: Verification }[];
  /** 1차 답이 틀렸던 항목 (학습용 사진 후보) */
  reports: BatchItem[];
  combo: number;
}

export function planBatch(items: BatchItem[]): BatchPlan {
  const saves: BatchPlan["saves"] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.choice || seen.has(item.choice)) continue;
    seen.add(item.choice);
    const v = item.verdict;
    // 모델 답 그대로이고 2차 판정도 반대하지 않았을 때만 "카메라 인증"
    const modelSaid = item.predicted.length === 1 && item.predicted[0] === item.choice;
    const clipOk = v === "pending" || v.kind === "match" || v.kind === "unsure";
    saves.push({ item, speciesId: item.choice, verifiedBy: modelSaid && clipOk ? "model" : "self" });
  }
  // 무리 단위에서 아직 안 고른 것은 오답이 아니라 "안 잡음"
  const reports = items.filter((i) =>
    i.choice
      ? !i.predicted.includes(i.choice)
      : i.touched || (i.verdict !== "pending" && i.verdict.kind === "none") || i.predicted.length === 1,
  );
  return { saves, reports, combo: comboBonus(saves.length) };
}
