import { SPECIES_BY_ID } from "@/data/species";
import { BASE_CAPTURE_CONF, captureThreshold, postProcess } from "./pipeline";
import type { Detection } from "./types";

// 사진 한 장 = 한 프레임 기준 채점. 앱에서 포획 가능 기준을 넘는 탐지만 "답"으로 본다.

export interface EvalFrame {
  file: string;
  /** 정답 종. 도감 밖 사진이면 null */
  truth: string | null;
  perModel: { model: string; detections: Detection[] }[];
}

export interface EvalResult {
  positives: number;
  negatives: number;
  correct: number;
  wrong: number;
  missed: number;
  falseOnNeg: number;
  wrongBy: [string, number][];
  errors: string[];
}

export function answersOf(detections: Detection[], guard = true): { id: string; conf: number }[] {
  const out: { id: string; conf: number }[] = [];
  for (const d of detections) {
    if (d.confidence < (guard ? captureThreshold(d.label) : BASE_CAPTURE_CONF)) continue;
    if (d.label.kind === "species") out.push({ id: d.label.speciesId, conf: d.confidence });
    if (d.label.kind === "group") for (const id of d.label.candidates) out.push({ id, conf: d.confidence });
  }
  return out;
}

export function scoreFrames(frames: EvalFrame[], opts: { guard: boolean; zone: boolean }): EvalResult {
  const r: EvalResult = { positives: 0, negatives: 0, correct: 0, wrong: 0, missed: 0, falseOnNeg: 0, wrongBy: [], errors: [] };
  const wrongBy = new Map<string, number>();
  for (const f of frames) {
    // 도감 밖 사진은 구역 정보가 없으므로 구역 필터 없이 채점 (가장 나쁜 경우)
    const zone = opts.zone && f.truth ? SPECIES_BY_ID[f.truth].zone : null;
    const { detections } = postProcess(f.perModel, { zone, guard: opts.guard });
    const answers = answersOf(detections, opts.guard);
    const ids = new Set(answers.map((a) => a.id));
    if (f.truth) {
      r.positives++;
      if (ids.has(f.truth)) r.correct++;
      else r.missed++;
      const others = [...ids].filter((id) => id !== f.truth);
      if (others.length) {
        r.wrong++;
        for (const id of others) wrongBy.set(id, (wrongBy.get(id) ?? 0) + 1);
        r.errors.push(`${f.file}: ${others.join(",")}`);
      }
    } else {
      r.negatives++;
      if (ids.size) {
        r.falseOnNeg++;
        for (const id of ids) wrongBy.set(id, (wrongBy.get(id) ?? 0) + 1);
        r.errors.push(`${f.file}: ${[...ids].join(",")}`);
      }
    }
  }
  r.wrongBy = [...wrongBy].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return r;
}
