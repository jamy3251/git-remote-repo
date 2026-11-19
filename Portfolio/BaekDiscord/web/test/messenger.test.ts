import { describe, expect, it } from "vitest";
import { channelLabel, eventsText, resultLines } from "@/lib/runner/messenger";

describe("messenger status text", () => {
  it("names the channels in Korean and passes unknown ones through", () => {
    expect(channelLabel("kakao")).toBe("카카오톡");
    expect(channelLabel("slack")).toBe("slack");
  });

  it("lists events in a fixed order with the digest interval", () => {
    expect(eventsText({ channels: ["telegram"], events: ["digest", "done", "start"], digestMin: 30 })).toBe("시작 · 완료 · 진행 요약 30분마다");
  });

  it("drops the digest when its interval is 0", () => {
    expect(eventsText({ channels: [], events: ["wait", "digest"], digestMin: 0 })).toBe("입력 대기");
    expect(eventsText({ channels: [], events: ["digest"], digestMin: 0 })).toBe("보내는 일 없음");
  });
});

describe("messenger send results", () => {
  it("reports each channel, with the reason on failure", () => {
    expect(resultLines([{ channel: "telegram", ok: true }, { channel: "kakao", ok: false, error: "kakao 401" }])).toEqual([
      { text: "텔레그램 전송됨", ok: true },
      { text: "카카오톡 실패: kakao 401", ok: false },
    ]);
  });

  it("says nothing was sent when no session runs", () => {
    expect(resultLines([], false)).toEqual([{ text: "실행 중인 세션이 없어 보내지 않았습니다", ok: true }]);
  });
});
