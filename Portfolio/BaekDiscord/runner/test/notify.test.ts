import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KAKAO_TEXT_MAX,
  Notifier,
  buildChannels,
  discordChannel,
  formatDigest,
  formatFinished,
  formatReview,
  formatStarted,
  kakaoChannel,
  readKakaoTokens,
  telegramChannel,
  writeKakaoTokens,
  type NotifyChannel,
  type NotifyConfig,
} from "../src/notify.js";
import type { SessionInfo, WorkLogEntry } from "../src/protocol.js";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (url: string, n: number) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = respond(String(url), calls.length);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { f, calls };
}

const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "s1",
  name: "결제 수정",
  preset: "claude",
  command: "claude",
  cwd: "D:\\Projects\\Shop",
  mode: "pty",
  status: "running",
  pid: 1,
  exitCode: null,
  createdAt: 0,
  endedAt: null,
  bytes: 0,
  tags: [],
  goal: null,
  policy: "assist",
  state: "working",
  stateReason: "도구 실행 중",
  lastOutputAt: null,
  lastLine: "",
  suggestion: null,
  cols: 100,
  rows: 30,
  agent: "claude",
  interactive: true,
  signal: "hook",
  claudeSessionId: null,
  ...over,
});

const entry = (over: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id: "s1",
  name: "결제 수정",
  preset: "claude-print",
  cwd: "D:\\Projects\\Shop",
  goal: null,
  prompt: null,
  startedAt: 0,
  endedAt: 12 * 60_000,
  status: "exited",
  exitCode: 0,
  bytes: 10,
  tail: [],
  git: { branch: "main", insertions: 40, deletions: 5, files: ["a.ts", "b.ts", "c.ts"] },
  summary: "결제 검증 로직을 고쳤습니다.",
  summarySource: "heuristic",
  ...over,
});

describe("message text", () => {
  it("says what finished, how long it took and what changed", () => {
    expect(formatFinished(entry())).toBe("[DevHub] 완료: 결제 수정\n12분 · 파일 3개 (+40 −5)\n결제 검증 로직을 고쳤습니다.");
  });

  it("names a failure with its exit code and a kill as a stop", () => {
    expect(formatFinished(entry({ exitCode: 1, git: null, summary: "" }))).toBe("[DevHub] 실패 (코드 1): 결제 수정\n12분 · 파일 변경 없음");
    expect(formatFinished(entry({ status: "killed", exitCode: null }))).toMatch(/^\[DevHub\] 중단: 결제 수정/);
  });

  it("start message carries the folder name, not the full path", () => {
    expect(formatStarted(session({ goal: "환불 버그" }))).toBe("[DevHub] 시작: 결제 수정 (claude)\n폴더: Shop\n목표: 환불 버그");
  });

  it("digest lists running sessions, waiting ones first, and is null when nothing runs", () => {
    const now = 90 * 60_000;
    const text = formatDigest(
      [session(), session({ id: "s2", name: "문서", state: "waiting_input", stateReason: "권한 확인 필요" }), session({ id: "s3", name: "끝난 것", status: "exited", state: "done" })],
      now,
    )!;
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^\[DevHub\] 진행 상황 \d{2}:\d{2}$/);
    expect(lines[1]).toBe("작업 중 1 · 입력 대기 1");
    expect(lines[2]).toBe("- 문서: 입력 대기, 권한 확인 필요 (1시간 30분째)");
    expect(lines[3]).toBe("- 결제 수정: 작업 중, 도구 실행 중 (1시간 30분째)");
    expect(lines).toHaveLength(4);
    expect(formatDigest([session({ status: "exited" })], now)).toBeNull();
  });

  it("review message carries the verdict", () => {
    expect(formatReview("결제 수정", "통과", "문제 없음")).toBe("[DevHub] 교차검증 통과: 결제 수정\n문제 없음");
  });
});

describe("channels", () => {
  it("discord posts the text as content", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 204 }));
    await discordChannel("https://example.test/hook", f).send("안녕");
    expect(calls[0].url).toBe("https://example.test/hook");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ content: "안녕" });
  });

  it("telegram sends to the configured chat and fails on a non-2xx", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: { ok: true } }));
    await telegramChannel("123456:telegram-token", "42", ok.f).send("안녕");
    expect(ok.calls[0].url).toBe("https://api.telegram.org/bot123456:telegram-token/sendMessage");
    expect(JSON.parse(String(ok.calls[0].init.body))).toMatchObject({ chat_id: "42", text: "안녕" });
    const bad = fakeFetch(() => ({ status: 403 }));
    await expect(telegramChannel("123456:telegram-token", "42", bad.f).send("x")).rejects.toThrow("telegram 403");
  });
});

describe("kakao", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-kakao-"));
  const file = path.join(dir, "kakao.json");
  afterEach(() => fs.rmSync(file, { force: true }));
  const opts = { restKey: "rest-key-0001", clientSecret: null, tokenFile: file, linkUrl: "https://example.test/control" };
  const template = (c: Call) => JSON.parse(new URLSearchParams(String(c.init.body)).get("template_object")!);

  it("asks for a login when there is no token file", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200 }));
    await expect(kakaoChannel(opts, f).send("x")).rejects.toThrow("devhubctl kakao login");
    expect(calls).toHaveLength(0);
  });

  it("sends a text template with the link, cut to the template limit", async () => {
    writeKakaoTokens(file, { access_token: "access-token-1", refresh_token: "refresh-token-1", expires_at: 10_000 });
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { result_code: 0 } }));
    await kakaoChannel(opts, f, () => 0).send("가".repeat(500));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://kapi.kakao.com/v2/api/talk/memo/default/send");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer access-token-1");
    const t = template(calls[0]);
    expect(t.object_type).toBe("text");
    expect(t.text).toHaveLength(KAKAO_TEXT_MAX);
    expect(t.link).toEqual({ web_url: "https://example.test/control", mobile_web_url: "https://example.test/control" });
  });

  it("refreshes an expired access token first, keeps the old refresh token when none comes back", async () => {
    writeKakaoTokens(file, { access_token: "old-access-token", refresh_token: "refresh-token-1", expires_at: 1 });
    const { f, calls } = fakeFetch((url) => (url.includes("kauth") ? { status: 200, body: { access_token: "new-access-token", expires_in: 21_600 } } : { status: 200 }));
    await kakaoChannel(opts, f, () => 1000).send("x");
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["kauth.kakao.com", "kapi.kakao.com"]);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ grant_type: "refresh_token", client_id: "rest-key-0001", refresh_token: "refresh-token-1" });
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer new-access-token");
    expect(readKakaoTokens(file)).toMatchObject({ access_token: "new-access-token", refresh_token: "refresh-token-1" });
  });

  it("on a 401 refreshes once and sends again", async () => {
    writeKakaoTokens(file, { access_token: "stale-access-token", refresh_token: "refresh-token-1", expires_at: 10_000 });
    const { f, calls } = fakeFetch((url, n) => (url.includes("kauth") ? { status: 200, body: { access_token: "new-access-token", refresh_token: "refresh-token-2" } } : { status: n === 1 ? 401 : 200 }));
    await kakaoChannel(opts, f, () => 0).send("x");
    expect(calls).toHaveLength(3);
    expect(readKakaoTokens(file)?.refresh_token).toBe("refresh-token-2");
  });

  it("tells the reader to log in again when the refresh is refused", async () => {
    writeKakaoTokens(file, { access_token: "old-access-token", refresh_token: "refresh-token-1", expires_at: 1 });
    const { f } = fakeFetch(() => ({ status: 400 }));
    await expect(kakaoChannel(opts, f, () => 1000).send("x")).rejects.toThrow("devhubctl kakao login");
  });
});

describe("Notifier", () => {
  const cfg = (over: Partial<NotifyConfig> = {}): NotifyConfig => ({
    webhook: null,
    telegramToken: null,
    telegramChatId: null,
    kakaoRestKey: null,
    kakaoClientSecret: null,
    kakaoTokenFile: "unused",
    digestMin: 30,
    events: ["start", "wait", "done", "review", "digest"],
    linkUrl: null,
    ...over,
  });

  it("builds only the channels that are fully configured", () => {
    expect(buildChannels(cfg())).toEqual([]);
    expect(buildChannels(cfg({ telegramToken: "123456:telegram-token" }))).toEqual([]);
    expect(buildChannels(cfg({ webhook: "https://example.test/h", telegramToken: "123456:telegram-token", telegramChatId: "1", kakaoRestKey: "rest-key-0001" })).map((c) => c.name)).toEqual(["discord", "telegram", "kakao"]);
  });

  it("one failing channel does not stop the other, and the failure is reported", async () => {
    const sent: string[] = [];
    const good: NotifyChannel = { name: "telegram", send: async (t) => void sent.push(t) };
    const bad: NotifyChannel = { name: "kakao", send: async () => Promise.reject(new Error("kakao 500")) };
    const errors: string[] = [];
    const n = new Notifier([bad, good], undefined, (c, m) => errors.push(`${c}: ${m}`));
    expect(await n.send("안녕")).toEqual([
      { channel: "kakao", ok: false, error: "kakao 500" },
      { channel: "telegram", ok: true },
    ]);
    expect(sent).toEqual(["안녕"]);
    expect(errors).toEqual(["kakao: kakao 500"]);
  });

  it("masks secrets before the text leaves, and skips events that are turned off", async () => {
    const sent: string[] = [];
    const ch: NotifyChannel = { name: "discord", send: async (t) => void sent.push(t) };
    const n = new Notifier([ch], ["done"]);
    await n.emit("start", "시작");
    await n.emit("done", "키는 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 입니다");
    await n.emit("done", null);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(new Notifier([], ["done"]).wants("done")).toBe(false);
  });
});
