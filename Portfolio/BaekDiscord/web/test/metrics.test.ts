import { describe, expect, it } from "vitest";
import { metricItems, minutesText, rateText } from "@/lib/runner/metrics";
import type { DecisionMetrics } from "@/lib/runner/protocol";

const base: DecisionMetrics = {
  decisions: 3,
  answered: 2,
  approval: { hit: 1, total: 2, rate: 0.5, enough: false },
  autoAgreement: { hit: 0, total: 0, rate: null, enough: false, undetermined: 1 },
  waitMedianMs: 90_000,
  waitSamples: 2,
  interventionsToday: 2,
  incidents: { autoReverted: 0, missedWaits: 1 },
  autoSent: 0,
};

describe("decision metrics text", () => {
  it("never shows a rate below the sample minimum", () => {
    expect(rateText({ hit: 1, total: 2, rate: 0.5, enough: false })).toBe("표본 부족 2/50");
    expect(rateText({ hit: 40, total: 50, rate: 0.8, enough: true })).toBe("80% (40/50)");
  });

  it("formats waits and flags incidents", () => {
    expect(minutesText(null)).toBe("-");
    expect(minutesText(30_000)).toBe("30초");
    expect(minutesText(90_000)).toBe("1.5분");
    const items = metricItems(base);
    expect(items.map((i) => i.label)).toEqual(["제안 승인", "자율 일치", "방치 시간", "오늘 개입", "사고"]);
    expect(items[1].value).toContain("판정 불가 1");
    expect(items[4]).toMatchObject({ value: "1건", warn: true });
  });
});
