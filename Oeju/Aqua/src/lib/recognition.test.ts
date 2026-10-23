import { afterEach, describe, expect, it, vi } from "vitest";
import clipText from "@/data/clip-text.json";
import { SPECIES } from "@/data/species";
import { verifyCrops } from "@/lib/server/verify";
import { applyVerdict, comboBonus, initialChoice, pick, planBatch, type BatchItem } from "./batch";
import { mapClass } from "./detection/classMap";
import { mergeDetections } from "./detection/merge";
import { captureThreshold, guard, postProcess, SUSPECT_CAPTURE_CONF } from "./detection/pipeline";
import type { Detection, DetectResponse } from "./detection/types";
import { CLIP_MODEL, decide, NEGATIVES, verifyPrompts } from "./detection/verify";
import { startDetectLoop } from "./detectLoop";
import { createLog, logFrame, topLabels } from "./fieldLog";

function det(rawClass: string, model: string, extra: Partial<Detection> = {}): Detection {
  return { x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.7, rawClass, label: mapClass(rawClass), model, ...extra };
}

describe("모델 간 의견", () => {
  it("두 모델이 같은 자리에 같은 종이면 일치 표시", () => {
    const [d] = mergeDetections([[det("Clownfish", "a")], [det("ClownFish", "b")]]);
    expect(d.agree).toBe(2);
  });

  it("같은 자리에 다른 종이면 다툼 표시 후 확신도를 깎는다", () => {
    const merged = mergeDetections([[det("Clownfish", "a", { confidence: 0.8 })], [det("BlueTang", "b", { confidence: 0.6 })]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].contested).toEqual(["blue-tang"]);
    expect(guard(merged)[0].confidence).toBeCloseTo(0.64);
  });

  it("화면을 거의 다 덮는 박스는 확신도를 깎는다", () => {
    const [d] = guard([det("Arowana", "a", { w: 0.9, h: 0.8, confidence: 0.8 })]);
    expect(d.confidence).toBeCloseTo(0.6);
  });

  it("모델이 내는 철자 YelloTang 도 옐로탱으로", () => {
    expect(mapClass("YelloTang")).toEqual({ kind: "species", speciesId: "yellow-tang" });
  });

  it("오인식이 잦은 종만 포획 기준이 높다", () => {
    expect(captureThreshold({ kind: "species", speciesId: "clownfish" })).toBe(SUSPECT_CAPTURE_CONF);
    expect(captureThreshold({ kind: "species", speciesId: "blue-tang" })).toBe(0.5);
  });

  it("구역 필터 → 병합 → 거름 순서", () => {
    // 아마존 구역에서는 흰동가리 답이 지워져서, 같은 자리의 피라냐가 남는다
    const { detections } = postProcess(
      [
        { model: "a", detections: [det("Clownfish", "a", { confidence: 0.9 })] },
        { model: "b", detections: [det("Piranha", "b", { confidence: 0.6 })] },
      ],
      { zone: "amazon", guard: true },
    );
    expect(detections.find((d) => d.label.kind === "species")?.label).toEqual({ kind: "species", speciesId: "red-bellied-piranha" });
  });
});

describe("2차 판정 (CLIP)", () => {
  const prompts = verifyPrompts(null);
  const sims = (winner: number, score = 0.33) => prompts.prompts.map((_, i) => (i === winner ? score : 0.2));
  const idx = (id: string) => prompts.speciesIds.indexOf(id);

  it("1차 답이 가장 비슷하면 맞음", () => {
    expect(decide(sims(idx("clownfish")), prompts, ["clownfish"]).kind).toBe("match");
  });

  it("다른 도감 종이 훨씬 비슷하면 그 종을 제안", () => {
    expect(decide(sims(idx("blue-tang")), prompts, ["clownfish"])).toMatchObject({ kind: "other", speciesId: "blue-tang" });
  });

  it("도감 밖 문장이 이기면 아무것도 아님", () => {
    expect(decide(sims(prompts.speciesIds.length + 1), prompts, ["clownfish"]).kind).toBe("none");
  });

  it("차이가 작으면 뒤집지 않는다", () => {
    const s = prompts.prompts.map((_, i) => (i === idx("blue-tang") ? 0.3 : i === idx("clownfish") ? 0.295 : 0.2));
    expect(decide(s, prompts, ["clownfish"]).kind).toBe("match");
  });

  it("구역을 고르면 그 구역 종만 후보", () => {
    const reef = verifyPrompts("reef");
    expect(reef.speciesIds).toContain("clownfish");
    expect(reef.speciesIds).not.toContain("arapaima");
    expect(reef.prompts).toHaveLength(reef.speciesIds.length + NEGATIVES.length);
  });

  it("미리 만든 문장 특징이 모든 문장을 덮는다", () => {
    const file = clipText as { model: string; vectors: Record<string, number[]> };
    expect(file.model).toBe(CLIP_MODEL);
    for (const p of prompts.prompts) expect(file.vectors[p]?.length, p).toBe(512);
    expect(prompts.speciesIds).toHaveLength(SPECIES.length);
  });

  it("CLIP 이 실패하면 판단 보류", async () => {
    const failing = (async () => new Response("down", { status: 500 })) as typeof fetch;
    const [v] = await verifyCrops([{ image: "x", predicted: ["clownfish"] }], null, { apiKey: "k", baseUrl: "http://clip", fetch: failing });
    expect(v.kind).toBe("unsure");
  });

  it("사진 특징을 문장 특징과 비교해 판정", async () => {
    const vectors = (clipText as { vectors: Record<string, number[]> }).vectors;
    const tang = vectors[prompts.prompts[idx("blue-tang")]];
    const fake = (async () =>
      Response.json({ embeddings: [tang], resolved_model: { model_id: CLIP_MODEL } })) as unknown as typeof fetch;
    const [v] = await verifyCrops([{ image: "x", predicted: ["clownfish"] }], null, { apiKey: "k", baseUrl: "http://clip", fetch: fake });
    expect(v).toMatchObject({ kind: "other", speciesId: "blue-tang" });
  });
});

function item(id: number, predicted: string[], extra: Partial<BatchItem> = {}): BatchItem {
  return {
    id,
    label: predicted.length === 1 ? { kind: "species", speciesId: predicted[0] } : { kind: "group", group: "shark", candidates: predicted },
    predicted,
    photo: null,
    trainingImage: "img",
    verifyImage: "v",
    confidence: 0.8,
    rawClass: "x",
    model: "m",
    verdict: "pending",
    choice: initialChoice(predicted),
    touched: false,
    ...extra,
  };
}

describe("한 번에 여러 마리 포획", () => {
  it("콤보 보너스: 2마리 x1.2, 최대 x1.6", () => {
    expect(comboBonus(1)).toBe(1);
    expect(comboBonus(2)).toBeCloseTo(1.2);
    expect(comboBonus(9)).toBeCloseTo(1.6);
  });

  it("2차 판정이 다른 종을 제안하면 선택을 바꾸고, 사용자가 고친 것은 그대로", () => {
    const other = { kind: "other", speciesId: "blue-tang", p: 0.7 } as const;
    expect(applyVerdict(item(1, ["clownfish"]), other).choice).toBe("blue-tang");
    expect(applyVerdict(pick(item(1, ["clownfish"]), "clownfish"), other).choice).toBe("clownfish");
    expect(applyVerdict(item(1, ["clownfish"]), { kind: "none", p: 0.8 }).choice).toBeNull();
  });

  it("맞게 잡은 것은 저장, 틀린 것은 학습용 후보, 같은 종은 한 번만", () => {
    const plan = planBatch([
      item(1, ["blue-tang"], { verdict: { kind: "match", p: 0.6 } }),
      item(2, ["clownfish"], { choice: "yellow-tang", verdict: { kind: "other", speciesId: "yellow-tang", p: 0.7 } }),
      item(3, ["lionfish"], { choice: null, touched: true }),
      item(4, ["blue-tang"]),
    ]);
    expect(plan.saves.map((s) => [s.speciesId, s.verifiedBy])).toEqual([
      ["blue-tang", "model"],
      ["yellow-tang", "self"],
    ]);
    expect(plan.reports.map((r) => r.id)).toEqual([2, 3]);
    expect(plan.combo).toBeCloseTo(1.2);
  });

  it("무리 단위에서 아직 안 고른 것은 오답으로 치지 않는다", () => {
    const plan = planBatch([item(1, ["zebra-shark", "blacktip-reef-shark"])]);
    expect(plan.saves).toHaveLength(0);
    expect(plan.reports).toHaveLength(0);
  });
});

describe("분석 모드 기록", () => {
  it("어떤 답이 몇 프레임에 나왔는지 집계", () => {
    const res = (dets: Detection[]): DetectResponse => ({ mode: "roboflow", detections: dets, latencyMs: 100, runs: [] });
    let log = createLog(0);
    log = logFrame(log, res([det("Clownfish", "a")]), 800);
    log = logFrame(log, res([det("Clownfish", "a"), det("Black_stingray", "a")]), 900);
    log = logFrame(log, res([]), 700);
    expect(log.frames).toBe(3);
    expect(log.empty).toBe(1);
    expect(topLabels(log)[0]).toMatchObject({ key: "s:clownfish", n: 2 });
  });
});

describe("인식 요청 겹쳐 보내기", () => {
  afterEach(() => vi.useRealTimers());

  async function simulate(roundTripMs: number, seconds: number, ok = true) {
    vi.useFakeTimers();
    let sent = 0;
    let maxConcurrent = 0;
    let concurrent = 0;
    const stop = startDetectLoop({
      send: () => {
        sent++;
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        return new Promise((r) =>
          setTimeout(() => {
            concurrent--;
            r(ok);
          }, roundTripMs),
        );
      },
      canSend: () => true,
      gapMs: 300,
      maxInFlight: 2,
    });
    await vi.advanceTimersByTimeAsync(seconds * 1000);
    stop();
    return { sent, maxConcurrent };
  }

  it("왕복 0.9초면 한 번에 하나일 때보다 약 2배 자주 보낸다", async () => {
    const { sent, maxConcurrent } = await simulate(900, 10);
    expect(maxConcurrent).toBe(2);
    // 하나씩이면 10초에 약 11번, 겹치면 약 21번
    expect(sent).toBeGreaterThanOrEqual(19);
  });

  it("빠른 응답이면 간격(0.3초) 이상으로 몰아치지 않는다", async () => {
    const { sent } = await simulate(50, 3);
    expect(sent).toBeLessThanOrEqual(11);
  });

  it("첫 응답이 오기 전(모델 깨우는 중)이나 계속 실패하면 하나씩만", async () => {
    const { maxConcurrent } = await simulate(900, 5, false);
    expect(maxConcurrent).toBe(1);
  });
});
