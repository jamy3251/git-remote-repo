import { describe, expect, it } from "vitest";
import { SPECIES, SPECIES_BY_ID } from "@/data/species";
import { addCapture, dailyMissions, emptyCollection, levelOf, parseCollection, xpFor } from "./collection";
import { mapClass } from "./detection/classMap";
import type { Detection } from "./detection/types";
import {
  canCapture,
  FAST_LOCK_HITS,
  initialTracker,
  LOCK_HITS,
  MAX_BATCH,
  readyTracks,
  stepTracks,
  type Tracker,
} from "./lockOn";

function det(rawClass: string, confidence = 0.6, x = 0.5, extra: Partial<Detection> = {}): Detection {
  return { x, y: 0.5, w: 0.2, h: 0.15, confidence, rawClass, label: mapClass(rawClass), ...extra };
}

function run(frames: Detection[][], start: Tracker = initialTracker): Tracker {
  return frames.reduce(stepTracks, start);
}

const times = (n: number, f: () => Detection[]) => Array.from({ length: n }, f);

describe("조준 유지 (여러 마리)", () => {
  it(`같은 자리에서 같은 종이 ${LOCK_HITS}번 이어지면 포획 가능`, () => {
    let s = run(times(LOCK_HITS - 1, () => [det("blue tang")]));
    expect(canCapture(s.tracks[0])).toBe(false);
    s = stepTracks(s, [det("blue tang")]);
    expect(canCapture(s.tracks[0])).toBe(true);
  });

  it(`두 모델이 같은 답이면 ${FAST_LOCK_HITS}번이면 된다`, () => {
    const s = run(times(FAST_LOCK_HITS, () => [det("blue tang", 0.6, 0.5, { agree: 2 })]));
    expect(canCapture(s.tracks[0])).toBe(true);
  });

  it("빈 프레임 한 번은 봐주고 두 번이면 놓친다", () => {
    let s = run([[det("blue tang")], [det("blue tang")], []]);
    expect(s.tracks[0].hits).toBe(2);
    s = stepTracks(s, [det("blue tang")]);
    expect(canCapture(s.tracks[0])).toBe(true);
    s = run([[], []], s);
    expect(s.tracks).toHaveLength(0);
  });

  it("같은 자리에서 답이 바뀌면 그 생물만 처음부터", () => {
    const s = run([[det("blue tang")], [det("blue tang")], [det("lionfish")]]);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].hits).toBe(1);
    expect(s.tracks[0].key).toBe("s:lionfish");
  });

  it("두 마리를 따로 조준하고 한 번에 잡는다", () => {
    const s = run(times(LOCK_HITS, () => [det("blue tang", 0.7, 0.25), det("piranha", 0.7, 0.75)]));
    expect(s.tracks).toHaveLength(2);
    expect(readyTracks(s).map((t) => t.key).sort()).toEqual(["s:blue-tang", "s:red-bellied-piranha"]);
  });

  it(`한 번에 최대 ${MAX_BATCH}마리`, () => {
    const s = run(
      times(LOCK_HITS, () => ["blue tang", "piranha", "arowana", "garden eel", "zebra shark"].map((c, i) => det(c, 0.75, 0.1 + i * 0.2))),
    );
    expect(readyTracks(s)).toHaveLength(MAX_BATCH);
  });

  it("확신도가 낮으면 횟수를 채워도 불가", () => {
    const s = run(times(LOCK_HITS + 2, () => [det("blue tang", 0.3)]));
    expect(canCapture(s.tracks[0])).toBe(false);
  });

  it("오인식이 잦은 종은 더 높은 확신이 필요", () => {
    const s = run(times(LOCK_HITS, () => [det("clownfish", 0.6)]));
    expect(canCapture(s.tracks[0])).toBe(false);
    const t = run(times(LOCK_HITS, () => [det("clownfish", 0.75)]));
    expect(canCapture(t.tracks[0])).toBe(true);
  });

  it("미등록 생물은 포획 불가", () => {
    const s = run(times(LOCK_HITS, () => [det("diver", 0.99)]));
    expect(canCapture(s.tracks[0])).toBe(false);
  });

  it("무리 단위도 포획 가능 (종은 사용자가 고름)", () => {
    const s = run(times(LOCK_HITS, () => [det("shark")]));
    expect(canCapture(s.tracks[0])).toBe(true);
    expect(s.tracks[0].label.kind).toBe("group");
  });
});

describe("도감과 경험치", () => {
  it("첫 포획은 2배, 재포획은 줄어든다", () => {
    const base = 10; // clownfish = common
    expect(xpFor("clownfish", 0)).toBe(base * 2);
    expect(xpFor("clownfish", 1)).toBe(5);
    expect(xpFor("clownfish", 50)).toBe(2);
  });

  it("addCapture 누적", () => {
    const a = addCapture(emptyCollection, { speciesId: "clownfish", confidence: 0.7, photo: "p1", verifiedBy: "model", at: 1 });
    expect(a.isNew).toBe(true);
    const b = addCapture(a.collection, { speciesId: "clownfish", confidence: 0.6, photo: "p2", verifiedBy: "model", at: 2 });
    expect(b.isNew).toBe(false);
    expect(b.collection.caught.clownfish).toMatchObject({ count: 2, firstAt: 1, lastAt: 2, bestConfidence: 0.7, photo: "p1" });
    expect(b.collection.xp).toBe(25);
  });

  it("모델 검증 기록은 자가 선택으로 덮이지 않는다", () => {
    const a = addCapture(emptyCollection, { speciesId: "zebra-shark", confidence: 0.8, photo: null, verifiedBy: "model", at: 1 });
    const b = addCapture(a.collection, { speciesId: "zebra-shark", confidence: 0.6, photo: null, verifiedBy: "self", at: 2 });
    expect(b.collection.caught["zebra-shark"].verifiedBy).toBe("model");
  });

  it("레벨", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(19)).toBe(1);
    expect(levelOf(20)).toBe(2);
    expect(levelOf(80)).toBe(3);
  });

  it("깨진 저장값은 빈 도감, 없는 종은 버림", () => {
    expect(parseCollection("{oops")).toEqual(emptyCollection);
    const raw = JSON.stringify({
      version: 1,
      xp: 5,
      caught: { ghost: { count: 1 }, clownfish: { count: 1, firstAt: 1, lastAt: 1, bestConfidence: 1, photo: null, verifiedBy: "model" } },
    });
    expect(Object.keys(parseCollection(raw).caught)).toEqual(["clownfish"]);
  });
});

describe("오늘의 탐사", () => {
  it("같은 날은 같은 목표, 구역이 겹치지 않고 전설은 없다", () => {
    const d = new Date(2026, 9, 16);
    const a = dailyMissions(d);
    expect(a).toEqual(dailyMissions(new Date(2026, 9, 16, 23)));
    expect(a).toHaveLength(3);
    const zones = a.map((id) => SPECIES_BY_ID[id].zone);
    expect(new Set(zones).size).toBe(3);
    expect(a.every((id) => SPECIES_BY_ID[id].rarity !== "legendary")).toBe(true);
  });
});

describe("종 데이터", () => {
  it("id 중복 없음, 사실 정보 있음", () => {
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
    expect(SPECIES.every((s) => s.facts.length >= 2 && s.tip)).toBe(true);
  });
});
