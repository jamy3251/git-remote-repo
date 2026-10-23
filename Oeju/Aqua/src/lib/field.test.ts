import { describe, expect, it } from "vitest";
import { addCapture, emptyCollection } from "./collection";
import { COEX_AQUARIUM, distanceM, formatDistance, judgeFix } from "./geo";
import { feedbackBatch, feedbackName, feedbackTags, readFeedbackProject } from "./server/feedback";
import { allow } from "./server/rateLimit";
import { isFieldKey, safeEqual } from "./server/secrets";

describe("코엑스 도착 확인 (GPS)", () => {
  // 실제 지점 좌표 (지도 기준 대략값)
  const gangnamStation = { lat: 37.4979, lng: 127.0276 };
  const samseongStation = { lat: 37.5089, lng: 127.0631 }; // 코엑스 남동쪽, 약 600m

  it("거리 계산이 상식적이다", () => {
    expect(distanceM(COEX_AQUARIUM, COEX_AQUARIUM)).toBe(0);
    const d = distanceM(COEX_AQUARIUM, gangnamStation);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(3600);
  });

  it("아쿠아리움 입구 근처 + 좋은 GPS → 도착", () => {
    expect(judgeFix({ lat: 37.5126, lng: 127.059, accuracy: 25 }).kind).toBe("inside");
  });

  it("강남역 → 밖 (거리 안내)", () => {
    const v = judgeFix({ ...gangnamStation, accuracy: 20 });
    expect(v.kind).toBe("outside");
    expect(formatDistance(v.distance)).toMatch(/km$/);
  });

  it("오차가 커도 오차 원 전체가 밖이면 밖", () => {
    expect(judgeFix({ ...gangnamStation, accuracy: 1500 }).kind).toBe("outside");
  });

  it("지하(와이파이·기지국 추정)라 오차가 크면 판단 보류 → QR 안내", () => {
    expect(judgeFix({ lat: 37.5128, lng: 127.0588, accuracy: 800 }).kind).toBe("uncertain");
  });

  it("반경 경계 근처에서 오차가 겹치면 보류", () => {
    const v = judgeFix({ ...samseongStation, accuracy: 250 });
    expect(v.kind).toBe("uncertain");
  });

  it("formatDistance", () => {
    expect(formatDistance(450)).toBe("450m");
    expect(formatDistance(3240)).toBe("3.2km");
  });
});

describe("현장 피드백 → Roboflow", () => {
  it("태그는 검색하기 좋게, 위험한 문자는 정리", () => {
    expect(
      feedbackTags({ kind: "misid", zone: "reef", rawClass: "Napoleon wrasse!", model: "aquarium-xj7ov/5", confidence: 0.834 }),
    ).toEqual([
      "kind:misid",
      "source:coex-aqua-dex",
      "zone:reef",
      "pred:Napoleon_wrasse_",
      "model:aquarium-xj7ov/5",
      "conf:83",
    ]);
    expect(feedbackTags({ kind: "field", zone: null })).toEqual(["kind:field", "source:coex-aqua-dex"]);
  });

  it("파일 이름과 배치", () => {
    const now = new Date("2026-10-16T12:34:56Z");
    expect(feedbackName({ kind: "field", zone: "shark" }, now)).toMatch(/^field-shark-20261016T123456-[a-z0-9]+\.jpg$/);
    expect(feedbackBatch({ kind: "misid", zone: null }, now)).toBe("misid-2026-10-16");
  });

  it("프로젝트는 워크스페이스 접두어가 붙어 와도 슬러그만", () => {
    expect(readFeedbackProject({ ROBOFLOW_FEEDBACK_PROJECT: "node-q3wtn/aqua-3kttf" })).toBe("aqua-3kttf");
    expect(readFeedbackProject({ ROBOFLOW_FEEDBACK_PROJECT: "aqua-3kttf" })).toBe("aqua-3kttf");
    expect(readFeedbackProject({})).toBeNull();
  });
});

describe("서버 보호 장치", () => {
  it("현장 암호", () => {
    expect(isFieldKey("abc", { FIELD_PASSCODE: "abc" })).toBe(true);
    expect(isFieldKey("abd", { FIELD_PASSCODE: "abc" })).toBe(false);
    expect(isFieldKey("abc", {})).toBe(false); // 암호가 없으면 현장 모드 꺼짐
    expect(isFieldKey(null, { FIELD_PASSCODE: "abc" })).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });

  it("시간당 제한", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(allow("k-test", 3, 1000, t + i)).toBe(true);
    expect(allow("k-test", 3, 1000, t + 10)).toBe(false);
    expect(allow("k-test", 3, 1000, t + 2000)).toBe(true);
  });
});

describe("현장 보너스", () => {
  it("경험치 1.5배", () => {
    const base = addCapture(emptyCollection, { speciesId: "clownfish", confidence: 0.8, photo: null, verifiedBy: "model", at: 1 });
    const boosted = addCapture(emptyCollection, {
      speciesId: "clownfish",
      confidence: 0.8,
      photo: null,
      verifiedBy: "model",
      at: 1,
      bonus: 1.5,
    });
    expect(base.xpGained).toBe(20);
    expect(boosted.xpGained).toBe(30);
  });
});
