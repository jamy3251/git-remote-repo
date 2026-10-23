import { SPECIES } from "@/data/species";
import { mapClass } from "./classMap";

export interface ModelInfo {
  id: string;
  role: string;
  classes: string[];
}

// 2026-10-16 Roboflow Universe 페이지에서 확인한 클래스 목록. 철자는 모델이 실제로 내는 그대로 (YelloTang 등, 2026-10-19 실측).
// ROBOFLOW_MODELS 를 비워두면 이 두 모델을 동시에 호출한다.
export const RECOMMENDED_MODELS: ModelInfo[] = [
  {
    id: "aquarium-xj7ov/5",
    role: "대형 수조·아마존 (mAP50 87.6%)",
    classes: [
      "African_manatee",
      "Arowana",
      "Black_stingray",
      "Blacktip_reef_shark",
      "California_sea_lion",
      "Clownfish",
      "Garden_eel",
      "Giant_grouper",
      "Humboldt_penguin",
      "Leatherback_sea_turtle",
      "Napoleon_wrasse",
      "Piranha",
      "Small_clawed_otter",
      "Zebra_shark",
    ],
  },
  {
    id: "fish-detection-fztlb/3",
    role: "산호초 관상어 (mAP50 92.1%)",
    classes: [
      "AngelFish",
      "BlueTang",
      "ButterflyFish",
      "ClownFish",
      "GoldFish",
      "Gourami",
      "MorishIdol",
      "PlatyFish",
      "RibbonedSweetlips",
      "ThreeStripedDamselfish",
      "YellowCichlid",
      "YelloTang",
      "ZebraFish",
    ],
  },
];

/** 무리 단위 보조 모델. 넣으면 해파리·기타 상어를 무리로 받는다 */
export const OPTIONAL_GROUP_MODEL: ModelInfo = {
  id: "aquarium-combined/6",
  role: "무리 단위 보조 (mAP50 77.1%)",
  classes: ["fish", "shark", "starfish", "jellyfish", "penguin", "stingray", "puffin"],
};

export type Recognition = "species" | "group" | "none";

/** 추천 모델 기준으로 각 종을 어디까지 알아볼 수 있는지 */
export function recognitionBySpecies(models: ModelInfo[] = RECOMMENDED_MODELS): Record<string, Recognition> {
  const result: Record<string, Recognition> = Object.fromEntries(SPECIES.map((s) => [s.id, "none"]));
  for (const m of models) {
    for (const c of m.classes) {
      const label = mapClass(c);
      if (label.kind === "species") result[label.speciesId] = "species";
      if (label.kind === "group") {
        for (const id of label.candidates) if (result[id] === "none") result[id] = "group";
      }
    }
  }
  return result;
}

export const RECOGNITION = recognitionBySpecies();
