import { describe, expect, it } from "vitest";
import { mapClass, normalizeClass } from "./classMap";
import { demoDetections } from "./demo";
import { iou, mergeDetections } from "./merge";
import { OPTIONAL_GROUP_MODEL, RECOGNITION, RECOMMENDED_MODELS, recognitionBySpecies } from "./models";
import { detectWithModels, parseRoboflow, readRoboflowConfig } from "./roboflow";
import type { Detection } from "./types";
import { isZoneId, restrictLabel, restrictToZone } from "./zone";

describe("mapClass", () => {
  it("종 이름은 표기가 달라도 도감 종으로", () => {
    expect(mapClass("Clown_Fish")).toEqual({ kind: "species", speciesId: "clownfish" });
    expect(mapClass("Amphiprion ocellaris")).toEqual({ kind: "species", speciesId: "clownfish" });
    expect(mapClass("blue-tang")).toEqual({ kind: "species", speciesId: "blue-tang" });
  });

  it("무리 이름은 후보 종과 함께", () => {
    const label = mapClass("Shark");
    expect(label.kind).toBe("group");
    if (label.kind === "group") {
      expect(label.candidates).toContain("sand-tiger-shark");
      expect(label.candidates.length).toBeGreaterThan(1);
    }
  });

  it("후보가 하나뿐인 무리는 바로 그 종", () => {
    expect(mapClass("jellyfish")).toEqual({ kind: "species", speciesId: "moon-jelly" });
    expect(mapClass("turtle")).toEqual({ kind: "species", speciesId: "green-sea-turtle" });
  });

  it("모르는 클래스는 unknown", () => {
    expect(mapClass("diver")).toEqual({ kind: "unknown", raw: "diver" });
  });

  it("normalizeClass", () => {
    expect(normalizeClass("  Sand_Tiger-Shark ")).toBe("sand tiger shark");
  });
});

describe("parseRoboflow", () => {
  it("픽셀 좌표를 0~1로, 신뢰도 높은 순으로", () => {
    const out = parseRoboflow(
      {
        image: { width: 640, height: 480 },
        predictions: [
          { x: 320, y: 240, width: 64, height: 48, confidence: 0.4, class: "yellow tang" },
          { x: 160, y: 120, width: 320, height: 240, confidence: 0.9, class: "shark" },
        ],
      },
      { width: 640, height: 480 },
    );
    expect(out).toHaveLength(2);
    expect(out[0].confidence).toBe(0.9);
    expect(out[0]).toMatchObject({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    expect(out[1].label).toEqual({ kind: "species", speciesId: "yellow-tang" });
  });

  it("응답에 image 크기가 없으면 보낸 크기로", () => {
    const out = parseRoboflow(
      { predictions: [{ x: 100, y: 50, width: 20, height: 10, confidence: 0.5, class: "lionfish" }] },
      { width: 200, height: 100 },
    );
    expect(out[0]).toMatchObject({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
  });

  it("잘못된 박스는 버린다", () => {
    const out = parseRoboflow(
      { predictions: [{ x: NaN, y: 1, width: 1, height: 1, confidence: 1, class: "x" }] },
      { width: 10, height: 10 },
    );
    expect(out).toEqual([]);
  });
});

describe("readRoboflowConfig", () => {
  it("키가 없으면 null (데모 모드)", () => {
    expect(readRoboflowConfig({ ROBOFLOW_MODELS: "a/1" })).toBeNull();
  });

  it("모델을 안 적으면 추천 두 모델", () => {
    const c = readRoboflowConfig({ ROBOFLOW_API_KEY: "k" });
    expect(c?.models).toEqual(["aquarium-xj7ov/5", "fish-detection-fztlb/3"]);
    expect(c).toMatchObject({ baseUrl: "https://serverless.roboflow.com", confidence: 35 });
  });

  it("쉼표 목록, 슬래시·중복 정리, 빈 신뢰도는 기본값", () => {
    const c = readRoboflowConfig({
      ROBOFLOW_API_KEY: "k",
      ROBOFLOW_MODELS: " /a/1/ , b/2,a/1,",
      ROBOFLOW_CONFIDENCE: "",
    });
    expect(c?.models).toEqual(["a/1", "b/2"]);
    expect(c?.confidence).toBe(35);
  });

  it("v0.1 의 ROBOFLOW_MODEL_ID 도 받는다", () => {
    expect(readRoboflowConfig({ ROBOFLOW_API_KEY: "k", ROBOFLOW_MODEL_ID: "x/9" })?.models).toEqual(["x/9"]);
  });
});

describe("추천 모델 클래스 매핑", () => {
  it("메인 모델의 표기가 도감 종으로 이어진다", () => {
    expect(mapClass("Black_stingray")).toEqual({ kind: "species", speciesId: "black-stingray" });
    expect(mapClass("Napoleon_wrasse")).toEqual({ kind: "species", speciesId: "napoleon-wrasse" });
    expect(mapClass("Arowana")).toEqual({ kind: "species", speciesId: "silver-arowana" });
    expect(mapClass("Leatherback_sea_turtle")).toEqual({ kind: "species", speciesId: "green-sea-turtle" });
    expect(mapClass("African_manatee").kind).toBe("unknown");
  });

  it("산호초 모델의 붙여 쓴 이름도 이어진다", () => {
    expect(mapClass("BlueTang")).toEqual({ kind: "species", speciesId: "blue-tang" });
    expect(mapClass("MorishIdol")).toEqual({ kind: "species", speciesId: "moorish-idol" });
    expect(mapClass("ButterflyFish")).toEqual({ kind: "species", speciesId: "butterflyfish" });
    expect(mapClass("GoldFish").kind).toBe("unknown");
  });

  it("stingray 는 가오리 무리 (바다·민물 둘 다 후보)", () => {
    const label = mapClass("stingray");
    expect(label.kind).toBe("group");
    if (label.kind === "group") expect(label.candidates).toEqual(expect.arrayContaining(["stingray", "black-stingray"]));
  });

  it("추천 모델 기준 인식 수준", () => {
    expect(RECOGNITION["zebra-shark"]).toBe("species");
    expect(RECOGNITION["yellow-tang"]).toBe("species");
    expect(RECOGNITION["sand-tiger-shark"]).toBe("none");
    expect(RECOGNITION["arapaima"]).toBe("none");
    // 보조 모델을 넣으면 상어·해파리가 무리 단위로 열린다
    const withGroup = recognitionBySpecies([...RECOMMENDED_MODELS, OPTIONAL_GROUP_MODEL]);
    expect(withGroup["sand-tiger-shark"]).toBe("group");
    expect(withGroup["moon-jelly"]).toBe("species");
  });
});

describe("여러 모델 동시 호출", () => {
  const box = (rawClass: string, confidence: number, x = 0.5, model = "m"): Detection => ({
    x, y: 0.5, w: 0.3, h: 0.3, confidence, rawClass, label: mapClass(rawClass), model,
  });

  it("같은 물체면 구체적인 라벨을 남긴다", () => {
    const out = mergeDetections([[box("Zebra_shark", 0.6, 0.5, "a")], [box("shark", 0.95, 0.52, "b")]]);
    expect(out).toHaveLength(1);
    expect(out[0].rawClass).toBe("Zebra_shark");
  });

  it("같은 등급이면 확신도 높은 쪽", () => {
    const out = mergeDetections([[box("Clownfish", 0.7)], [box("ClownFish", 0.9)]]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.9);
  });

  it("떨어진 물체는 둘 다 남는다", () => {
    expect(mergeDetections([[box("Clownfish", 0.7, 0.2)], [box("BlueTang", 0.8, 0.8)]])).toHaveLength(2);
  });

  it("iou", () => {
    expect(iou(box("a", 1), box("a", 1))).toBeCloseTo(1);
    expect(iou(box("a", 1, 0.1), box("a", 1, 0.9))).toBe(0);
  });

  it("한 모델이 실패해도 나머지로 계속", async () => {
    const res = await detectWithModels(["ok/1", "bad/1"], async (m) => {
      if (m === "bad/1") throw new Error("down");
      return [box("Clownfish", 0.8, 0.5, m)];
    });
    expect(res.detections).toHaveLength(1);
    expect(res.runs.map((r) => r.ok)).toEqual([true, false]);
  });

  it("전부 실패하면 에러", async () => {
    await expect(
      detectWithModels(["a/1", "b/1"], async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow();
  });

  it("호출은 동시에 시작된다", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = detectWithModels(["a/1", "b/1"], async (m) => {
      started.push(m);
      await gate;
      return [];
    });
    await Promise.resolve();
    expect(started).toEqual(["a/1", "b/1"]);
    release();
    await p;
  });
});

describe("demoDetections", () => {
  it("한 슬롯 안에서는 같은 생물", () => {
    const a = demoDetections(7000 * 3 + 2000);
    const b = demoDetections(7000 * 3 + 4000);
    expect(a[0].rawClass).toBe(b[0].rawClass);
  });
});

describe("구역 필터", () => {
  const box = (rawClass: string, confidence: number, model: string): Detection => ({
    x: 0.5, y: 0.5, w: 0.3, h: 0.3, confidence, rawClass, label: mapClass(rawClass), model,
  });

  it("같은 구역 종끼리 헷갈리면 구역 필터로는 못 거른다 (확인 버튼이 마지막 방어선)", () => {
    // 흰동가리와 블루탱은 같은 구역이라 구역 필터로는 못 거른다 → 확인 버튼이 마지막 방어선
    const out = mergeDetections(
      [box("Clownfish", 0.79, "a"), box("BlueTang", 0.7, "b")].map((d) => restrictToZone([d], "reef")),
    );
    expect(out).toHaveLength(1);
    expect(out[0].rawClass).toBe("Clownfish");
  });

  it("아마존에서 나폴레옹피시 83%(오답)는 지워지고 같은 자리의 피라냐가 남는다", () => {
    const out = mergeDetections(
      [box("Napoleon_wrasse", 0.83, "a"), box("Piranha", 0.5, "a")].map((d) => restrictToZone([d], "amazon")),
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toEqual({ kind: "species", speciesId: "red-bellied-piranha" });
  });

  it("구역 밖 종은 모르는 생물(포획 불가)로", () => {
    expect(restrictLabel(mapClass("Blacktip_reef_shark"), "Blacktip_reef_shark", "reef")).toEqual({
      kind: "unknown",
      raw: "Blacktip_reef_shark",
    });
  });

  it("무리 후보도 구역으로 좁힌다", () => {
    // 아마존의 가오리는 블랙 스팅레이 하나뿐 → 바로 종
    expect(restrictLabel(mapClass("stingray"), "stingray", "amazon")).toEqual({ kind: "species", speciesId: "black-stingray" });
    // 산호초에 상어는 없다
    expect(restrictLabel(mapClass("shark"), "shark", "reef").kind).toBe("unknown");
  });

  it("구역을 모르면 그대로", () => {
    const d = [box("Clownfish", 0.8, "a")];
    expect(restrictToZone(d, null)).toBe(d);
  });

  it("isZoneId", () => {
    expect(isZoneId("reef")).toBe(true);
    expect(isZoneId("moon")).toBe(false);
    expect(isZoneId(undefined)).toBe(false);
  });
});
