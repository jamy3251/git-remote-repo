import type { GroupId } from "@/data/species";

/** 도감 기준으로 해석한 라벨 */
export type Label =
  | { kind: "species"; speciesId: string }
  | { kind: "group"; group: GroupId; candidates: string[] }
  | { kind: "unknown"; raw: string };

/** 좌표는 보낸 이미지 기준 0~1, (x, y)는 박스 중심 */
export interface Detection {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  rawClass: string;
  label: Label;
  /** 이 탐지를 낸 모델 ID */
  model?: string;
  /** 병합 후: 같은 자리에서 같은 답을 낸 모델 수 */
  agree?: number;
  /** 병합 후: 같은 자리에서 다른 모델이 낸 다른 종 이름 */
  contested?: string[];
}

export type DetectMode = "roboflow" | "demo";

export interface ModelRun {
  model: string;
  ok: boolean;
  ms: number;
}

export interface DetectResponse {
  mode: DetectMode;
  detections: Detection[];
  latencyMs: number;
  runs: ModelRun[];
  /** 현장 모드에서만: 병합 전 모델별 원본 결과 */
  raw?: { model: string; detections: Detection[] }[];
}

export interface DetectStatus {
  mode: DetectMode;
  models: string[];
}

export function labelKey(label: Label): string {
  if (label.kind === "species") return `s:${label.speciesId}`;
  if (label.kind === "group") return `g:${label.group}`;
  return `u:${label.raw}`;
}
