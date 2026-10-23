import { BASE_CAPTURE_CONF, captureThreshold } from "./detection/pipeline";
import { labelKey, type Detection, type Label } from "./detection/types";

// 조준 유지 = 시간 투표. 한 프레임 결과는 흔들리므로
// 같은 자리에서 같은 라벨이 이어서 잡혀야 포획 가능 상태가 된다.
// 화면에 여러 마리가 있으면 각자 따로 조준한다(트랙).

export const LOCK_HITS = 3;
/** 두 모델이 같은 답을 냈거나 확신이 아주 높으면 이만큼만 이어져도 된다 */
export const FAST_LOCK_HITS = 2;
export const FAST_LOCK_CONF = 0.8;
export const MIN_AVG_CONF = BASE_CAPTURE_CONF;
/** 빈 프레임은 이만큼까지 봐준다 (물고기가 잠깐 겹치거나 반사될 때) */
export const GRACE_MISSES = 1;
export const MAX_TRACKS = 6;
/** 한 번에 포획할 수 있는 최대 마리 수 */
export const MAX_BATCH = 4;
const SMOOTH = 0.45;
/** 같은 물체로 볼 최대 중심 거리 (화면 비율) */
const MATCH_DIST = 0.14;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Track {
  id: number;
  key: string;
  label: Label;
  rawClass: string;
  model: string | null;
  hits: number;
  misses: number;
  confSum: number;
  /** 이 라벨로 잡힌 동안 두 모델이 한 번이라도 같은 답을 냈는지 */
  agreed: boolean;
  box: Box;
}

export interface Tracker {
  tracks: Track[];
  nextId: number;
}

export const initialTracker: Tracker = { tracks: [], nextId: 1 };

/** 화면 가운데에 가깝고 크고 확실한 것일수록 높다 */
export function priority(d: { x: number; y: number; w: number; h: number }, confidence: number): number {
  return confidence + Math.sqrt(d.w * d.h) * 0.6 - Math.hypot(d.x - 0.5, d.y - 0.5) * 0.8;
}

function distance(a: Box, b: Box): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function overlaps(a: Box, b: Box): boolean {
  // 박스가 크면 중심이 좀 더 움직여도 같은 물체로 본다
  const reach = Math.max(MATCH_DIST, Math.min(0.3, Math.max(a.w, a.h, b.w, b.h) * 0.5));
  return distance(a, b) <= reach;
}

function fresh(id: number, d: Detection): Track {
  return {
    id,
    key: labelKey(d.label),
    label: d.label,
    rawClass: d.rawClass,
    model: d.model ?? null,
    hits: 1,
    misses: 0,
    confSum: d.confidence,
    agreed: (d.agree ?? 1) >= 2,
    box: { x: d.x, y: d.y, w: d.w, h: d.h },
  };
}

export function stepTracks(state: Tracker, detections: Detection[]): Tracker {
  const free = new Set(detections.map((_, i) => i));
  const next: Track[] = [];
  let nextId = state.nextId;

  // 오래 이어진 트랙부터 짝을 찾는다. 같은 라벨을 먼저, 그다음 가장 가까운 것
  const ordered = [...state.tracks].sort((a, b) => b.hits - a.hits);
  for (const t of ordered) {
    let best = -1;
    let bestScore = Infinity;
    for (const i of free) {
      const d = detections[i];
      if (!overlaps(t.box, d)) continue;
      const score = distance(t.box, d) - (labelKey(d.label) === t.key ? 1 : 0);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) {
      if (t.misses < GRACE_MISSES) next.push({ ...t, misses: t.misses + 1 });
      continue;
    }
    free.delete(best);
    const d = detections[best];
    if (labelKey(d.label) !== t.key) {
      // 같은 자리인데 답이 바뀌었다: 조준을 처음부터 (트랙 id는 유지해 화면이 튀지 않게)
      next.push(fresh(t.id, d));
      continue;
    }
    next.push({
      ...t,
      label: d.label,
      rawClass: d.rawClass,
      model: d.model ?? t.model,
      hits: t.hits + 1,
      misses: 0,
      confSum: t.confSum + d.confidence,
      agreed: t.agreed || (d.agree ?? 1) >= 2,
      box: {
        x: lerp(t.box.x, d.x),
        y: lerp(t.box.y, d.y),
        w: lerp(t.box.w, d.w),
        h: lerp(t.box.h, d.h),
      },
    });
  }
  for (const i of free) next.push(fresh(nextId++, detections[i]));

  next.sort((a, b) => priority(b.box, avgConfidence(b)) - priority(a.box, avgConfidence(a)));
  return { tracks: next.slice(0, MAX_TRACKS), nextId };
}

export function avgConfidence(t: Track): number {
  return t.hits ? t.confSum / t.hits : 0;
}

export function requiredHits(t: Track): number {
  return t.agreed || avgConfidence(t) >= FAST_LOCK_CONF ? FAST_LOCK_HITS : LOCK_HITS;
}

export function lockProgress(t: Track): number {
  return Math.min(1, t.hits / requiredHits(t));
}

export function captureBar(t: Track, base = MIN_AVG_CONF): number {
  return captureThreshold(t.label, base);
}

export function canCapture(t: Track, base = MIN_AVG_CONF): boolean {
  return t.label.kind !== "unknown" && t.hits >= requiredHits(t) && avgConfidence(t) >= captureBar(t, base);
}

/** 지금 셔터를 누르면 잡히는 트랙들 (우선순위 순, 최대 MAX_BATCH) */
export function readyTracks(state: Tracker, base = MIN_AVG_CONF): Track[] {
  return state.tracks.filter((t) => t.misses === 0 && canCapture(t, base)).slice(0, MAX_BATCH);
}

function lerp(a: number, b: number): number {
  return a + (b - a) * SMOOTH;
}
