import type { DetectResponse } from "./detection/types";
import { labelKey } from "./detection/types";

// 분석 모드 기록: 영상·수조 앞에서 일정 시간 돌려 두고 어떤 답이 얼마나 나왔는지 모은다.
// 현장에서 "무엇으로 쏠리는가"를 숫자로 보기 위한 것 (0단계 측정의 현장판).

export interface LabelStat {
  n: number;
  confSum: number;
  models: Record<string, number>;
  raw: Record<string, number>;
}

export interface FieldLog {
  startedAt: number;
  frames: number;
  /** 아무것도 안 잡힌 프레임 */
  empty: number;
  rttSum: number;
  labels: Record<string, LabelStat>;
}

export function createLog(now: number): FieldLog {
  return { startedAt: now, frames: 0, empty: 0, rttSum: 0, labels: {} };
}

export function logFrame(log: FieldLog, res: DetectResponse, rttMs: number): FieldLog {
  const labels = { ...log.labels };
  for (const d of res.detections) {
    const k = labelKey(d.label);
    const prev = labels[k] ?? { n: 0, confSum: 0, models: {}, raw: {} };
    const model = d.model ?? "?";
    labels[k] = {
      n: prev.n + 1,
      confSum: prev.confSum + d.confidence,
      models: { ...prev.models, [model]: (prev.models[model] ?? 0) + 1 },
      raw: { ...prev.raw, [d.rawClass]: (prev.raw[d.rawClass] ?? 0) + 1 },
    };
  }
  return {
    ...log,
    frames: log.frames + 1,
    empty: log.empty + (res.detections.length ? 0 : 1),
    rttSum: log.rttSum + rttMs,
    labels,
  };
}

export function topLabels(log: FieldLog, limit = 5): { key: string; n: number; share: number; avgConf: number }[] {
  return Object.entries(log.labels)
    .map(([key, s]) => ({ key, n: s.n, share: log.frames ? s.n / log.frames : 0, avgConf: s.confSum / s.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}
