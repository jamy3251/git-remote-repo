import { describe, expect, it } from "vitest";
import { digestDateFor, digestDayBounds, editWindowOpen, formatDigestDateKo, kstDateString } from "@/lib/digest/window";

const kst = (iso: string) => new Date(`${iso}+09:00`);

describe("digest day boundary (21:00 KST, receipt time)", () => {
  it("computes [prev 21:00, 21:00) in UTC", () => {
    const { start, end } = digestDayBounds("2026-09-22");
    expect(start.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });

  it("assigns 20:59 / 21:00 / 21:01 to exactly one digest each", () => {
    expect(digestDateFor(kst("2026-09-22T20:59:59"))).toBe("2026-09-22");
    expect(digestDateFor(kst("2026-09-22T21:00:00"))).toBe("2026-09-23");
    expect(digestDateFor(kst("2026-09-22T21:01:00"))).toBe("2026-09-23");
  });

  it("agrees with the bounds: a timestamp belongs to the date whose bounds contain it", () => {
    for (const t of ["2026-09-22T20:59:59", "2026-09-22T21:00:00", "2026-09-22T21:01:00", "2026-09-23T03:00:00"]) {
      const d = digestDateFor(kst(t));
      const { start, end } = digestDayBounds(d);
      expect(kst(t).getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(kst(t).getTime()).toBeLessThan(end.getTime());
    }
  });

  it("formats KST calendar dates across the UTC midnight", () => {
    expect(kstDateString(new Date("2026-09-22T15:30:00Z"))).toBe("2026-09-23");
    expect(kstDateString(new Date("2026-09-22T14:59:00Z"))).toBe("2026-09-22");
  });

  it("formats the Korean date label", () => {
    expect(formatDigestDateKo("2026-09-21")).toBe("9/21 (월)");
    expect(formatDigestDateKo("2026-09-27")).toBe("9/27 (일)");
  });
});

describe("edit window (published_at + 60분, derived)", () => {
  const published = new Date("2026-09-22T12:03:00Z");
  it("is open at 59 minutes and closed at 60 / 61 minutes", () => {
    expect(editWindowOpen(published, new Date(published.getTime() + 59 * 60_000))).toBe(true);
    expect(editWindowOpen(published, new Date(published.getTime() + 60 * 60_000))).toBe(false);
    expect(editWindowOpen(published, new Date(published.getTime() + 61 * 60_000))).toBe(false);
  });
  it("is closed when never published", () => {
    expect(editWindowOpen(null, new Date())).toBe(false);
  });
});
