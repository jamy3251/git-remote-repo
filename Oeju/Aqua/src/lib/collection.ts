import { RARITY, SPECIES, SPECIES_BY_ID, type ZoneId } from "@/data/species";
import { RECOGNITION } from "./detection/models";

export type Verification = "model" | "self";

export interface CaughtEntry {
  count: number;
  firstAt: number;
  lastAt: number;
  bestConfidence: number;
  photo: string | null;
  verifiedBy: Verification;
}

export interface Collection {
  version: 1;
  xp: number;
  caught: Record<string, CaughtEntry>;
}

export interface CaptureInput {
  speciesId: string;
  confidence: number;
  photo: string | null;
  verifiedBy: Verification;
  at: number;
  /** 현장 보너스 등 경험치 배율 */
  bonus?: number;
}

export interface CaptureResult {
  collection: Collection;
  isNew: boolean;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
}

export const emptyCollection: Collection = { version: 1, xp: 0, caught: {} };

/** 첫 포획은 2배, 같은 종 재포획은 점점 줄어든다 (최소 2) */
export function xpFor(speciesId: string, previousCount: number): number {
  const base = RARITY[SPECIES_BY_ID[speciesId].rarity].xp;
  if (previousCount === 0) return base * 2;
  return Math.max(2, Math.round(base / (previousCount + 1)));
}

export function levelOf(xp: number): number {
  return Math.floor(Math.sqrt(xp / 20)) + 1;
}

export function levelRange(level: number): { from: number; to: number } {
  return { from: 20 * (level - 1) ** 2, to: 20 * level ** 2 };
}

export function addCapture(collection: Collection, input: CaptureInput): CaptureResult {
  if (!SPECIES_BY_ID[input.speciesId]) throw new Error(`unknown species ${input.speciesId}`);
  const prev = collection.caught[input.speciesId];
  const xpGained = Math.round(xpFor(input.speciesId, prev?.count ?? 0) * (input.bonus ?? 1));

  const entry: CaughtEntry = prev
    ? {
        count: prev.count + 1,
        firstAt: prev.firstAt,
        lastAt: input.at,
        bestConfidence: Math.max(prev.bestConfidence, input.confidence),
        // 더 확실하게 잡힌 사진으로 교체
        photo: input.confidence >= prev.bestConfidence && input.photo ? input.photo : prev.photo,
        verifiedBy: prev.verifiedBy === "model" ? "model" : input.verifiedBy,
      }
    : {
        count: 1,
        firstAt: input.at,
        lastAt: input.at,
        bestConfidence: input.confidence,
        photo: input.photo,
        verifiedBy: input.verifiedBy,
      };

  const next: Collection = {
    ...collection,
    xp: collection.xp + xpGained,
    caught: { ...collection.caught, [input.speciesId]: entry },
  };
  return {
    collection: next,
    isNew: !prev,
    xpGained,
    levelBefore: levelOf(collection.xp),
    levelAfter: levelOf(next.xp),
  };
}

export function zoneProgress(collection: Collection, zone: ZoneId): { caught: number; total: number } {
  const inZone = SPECIES.filter((s) => s.zone === zone);
  return { caught: inZone.filter((s) => collection.caught[s.id]).length, total: inZone.length };
}

export function parseCollection(raw: string | null): Collection {
  if (!raw) return emptyCollection;
  try {
    const data = JSON.parse(raw) as Collection;
    if (data?.version !== 1 || typeof data.xp !== "number" || typeof data.caught !== "object") {
      return emptyCollection;
    }
    // 도감에서 빠진 종은 버린다
    const caught = Object.fromEntries(
      Object.entries(data.caught).filter(([id]) => SPECIES_BY_ID[id]),
    );
    return { version: 1, xp: data.xp, caught };
  } catch {
    return emptyCollection;
  }
}

/** 날짜마다 같은 3종. 구역이 겹치지 않게 골라 동선을 넓힌다 */
export function dailyMissions(date: Date, count = 3): string[] {
  const seedStr = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  // 인식 모델이 아예 못 알아보는 종은 목표로 내지 않는다
  const pool = SPECIES.filter((s) => s.rarity !== "legendary" && RECOGNITION[s.id] !== "none");
  const picked: string[] = [];
  const usedZones = new Set<ZoneId>();
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const s of shuffled) {
    if (picked.length >= count) break;
    if (usedZones.has(s.zone)) continue;
    picked.push(s.id);
    usedZones.add(s.zone);
  }
  return picked;
}

export function caughtOnDay(entry: CaughtEntry | undefined, date: Date): boolean {
  if (!entry) return false;
  const d = new Date(entry.lastAt);
  return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
}
