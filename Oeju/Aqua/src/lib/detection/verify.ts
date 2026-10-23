import { SPECIES, SPECIES_BY_ID, type ZoneId } from "@/data/species";

// 2차 판정: 포획 순간 잘라낸 사진을 CLIP(사진-문장 비교 모델)로 다시 본다.
// 1차 모델은 정해진 칸 중 하나를 억지로 고르지만, CLIP은 "도감에 없는 물고기"나
// "빈 수조"라는 답도 고를 수 있다.

/** 문장 특징 파일(src/data/clip-text.json)을 만든 모델. 사진 특징도 같은 모델이어야 비교할 수 있다 */
export const CLIP_MODEL = "clip/ViT-B-16";

/** 생김새 위주 설명. 이름만 주는 것보다 CLIP이 잘 구분한다 */
export const LOOKS: Record<string, string> = {
  arapaima: "an arapaima, a huge long grey and red freshwater fish",
  "red-bellied-piranha": "a red-bellied piranha, a silver fish with a red belly",
  "silver-arowana": "a silver arowana, a long silver fish with big scales and chin barbels",
  seahorse: "a seahorse",
  clownfish: "an orange clownfish with white stripes, often in a sea anemone",
  "blue-tang": "a blue tang, a bright blue fish with a yellow tail",
  "yellow-tang": "a yellow tang, a flat bright yellow fish",
  "moorish-idol": "a moorish idol, a black white and yellow fish with a long dorsal fin",
  lionfish: "a lionfish with striped venomous spines",
  porcupinefish: "a porcupinefish, a spotted puffer fish with spines",
  "moray-eel": "a moray eel poking out of a rock",
  "sand-tiger-shark": "a sand tiger shark with ragged teeth",
  "zebra-shark": "a zebra shark, a spotted shark with a long tail",
  "blacktip-reef-shark": "a blacktip reef shark with black fin tips",
  stingray: "a stingray, a flat ray with a long whip tail",
  "giant-grouper": "a giant grouper, a huge heavy mottled fish",
  "green-sea-turtle": "a sea turtle swimming",
  "moon-jelly": "a moon jellyfish, a translucent jellyfish",
  "black-stingray": "a black freshwater stingray with white spots",
  "napoleon-wrasse": "a humphead wrasse, a big green fish with a bump on its forehead",
  "garden-eel": "garden eels sticking out of the sand",
  butterflyfish: "a butterflyfish, a small flat yellow and white reef fish",
  "small-clawed-otter": "an otter",
  "humboldt-penguin": "a penguin",
};

/**
 * 도감 종이 아닌 답들. 이쪽이 이기면 "아무것도 아님".
 * 수조에 흔한 다른 물고기를 따로 적어야 CLIP이 "다른 물고기"를 도감 종에 끼워 맞추지 않는다.
 */
export const NEGATIVES = [
  "a different kind of fish",
  "a small colorful tropical fish",
  "a koi carp or goldfish",
  "a catfish",
  "a parrotfish",
  "a triggerfish",
  "a discus or cichlid",
  "a starfish or sea urchin",
  "an octopus or squid",
  "a crab or shrimp",
  "an empty aquarium with rocks, plants and water",
  "coral or a sea anemone with no fish",
  "people standing in front of an aquarium",
  "a blurry dark background",
];

export interface VerifyPrompts {
  speciesIds: string[];
  prompts: string[];
}

export function verifyPrompts(zone: ZoneId | null): VerifyPrompts {
  const speciesIds = SPECIES.filter((s) => !zone || s.zone === zone).map((s) => s.id);
  const prompts = [...speciesIds.map((id) => `a photo of ${LOOKS[id] ?? SPECIES_BY_ID[id].nameEn}`), ...NEGATIVES.map((n) => `a photo of ${n}`)];
  return { speciesIds, prompts };
}

export type Verdict =
  /** 1차 답이 맞는 것 같음 */
  | { kind: "match"; p: number }
  /** 다른 도감 종 같음 */
  | { kind: "other"; speciesId: string; p: number }
  /** 도감 종이 아닌 것 같음 */
  | { kind: "none"; p: number }
  /** 판단하기 어려움 (1차 답 유지) */
  | { kind: "unsure" };

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** CLIP 유사도 → 확률 (CLIP 기본 온도 100) */
export function softmax(similarity: number[], scale = 100): number[] {
  const max = Math.max(...similarity);
  const e = similarity.map((s) => Math.exp((s - max) * scale));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

export interface VerifyRules {
  /** 다른 답(다른 종 또는 도감 밖)이 이 확률 이상이고 */
  overturnP: number;
  /** 1차 답보다 이 배수 이상 높아야 뒤집는다 */
  overturnRatio: number;
}

// 2026-10-19 위키미디어 사진 160장 + 모니터 촬영 흉내 160장으로 고른 값 (scripts/eval-verify.ts)
export const VERIFY_RULES: VerifyRules = { overturnP: 0.5, overturnRatio: 3 };

export function decide(
  similarity: number[],
  prompts: VerifyPrompts,
  predicted: string[],
  rules: VerifyRules = VERIFY_RULES,
): Verdict {
  const p = softmax(similarity);
  const n = prompts.speciesIds.length;
  // 무리 단위 답(상어류 등)은 후보 종들의 확률을 합친다
  let predP = 0;
  let other = -1;
  for (let i = 0; i < n; i++) {
    if (predicted.includes(prompts.speciesIds[i])) predP += p[i];
    else if (other < 0 || p[i] > p[other]) other = i;
  }
  const negP = p.slice(n).reduce((a, b) => a + b, 0);
  const otherP = other >= 0 ? p[other] : 0;
  const rival = Math.max(negP, otherP);
  if (rival >= rules.overturnP && rival >= predP * rules.overturnRatio) {
    return otherP > negP ? { kind: "other", speciesId: prompts.speciesIds[other], p: otherP } : { kind: "none", p: negP };
  }
  return predP > 0 ? { kind: "match", p: predP } : { kind: "unsure" };
}
