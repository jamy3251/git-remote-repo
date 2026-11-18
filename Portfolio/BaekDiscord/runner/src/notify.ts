/**
 * Progress messages to the owner's messenger: session started, waiting for input, finished (with what
 * changed), cross-review verdict, and a periodic status digest.
 *
 * Channels (any mix, all optional):
 *   discord   SUPERVISOR_NOTIFY_WEBHOOK            Discord-compatible webhook
 *   telegram  NOTIFY_TELEGRAM_TOKEN + _CHAT_ID     bot message
 *   kakao     NOTIFY_KAKAO_REST_KEY                KakaoTalk "나에게 보내기"; tokens from `devhubctl kakao login`
 *
 * Text is masked with redactSecrets before it leaves the machine. A failing channel never blocks the
 * others or the runner: failures go to `onError`.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets, registerExactSecret } from "./security.js";
import type { SessionInfo, WorkLogEntry } from "./protocol.js";

export type NotifyEvent = "start" | "wait" | "done" | "review" | "digest";
export const NOTIFY_EVENTS: readonly NotifyEvent[] = ["start", "wait", "done", "review", "digest"];

export interface NotifyConfig {
  webhook: string | null;
  telegramToken: string | null;
  telegramChatId: string | null;
  kakaoRestKey: string | null;
  kakaoClientSecret: string | null;
  kakaoTokenFile: string;
  /** Minutes between status digests while sessions run; 0 turns the digest off. */
  digestMin: number;
  events: NotifyEvent[];
  /** Link put on messages that support one (the dashboard address you open from the phone). */
  linkUrl: string | null;
}

type Fetch = typeof fetch;

export interface NotifyChannel {
  name: "discord" | "telegram" | "kakao";
  send(text: string): Promise<void>;
}

export interface SendResult {
  channel: string;
  ok: boolean;
  error?: string;
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export function discordChannel(url: string, f: Fetch = fetch): NotifyChannel {
  return {
    name: "discord",
    async send(text) {
      const res = await f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: clip(text, 1900) }) });
      if (!res.ok && res.status !== 204) throw new Error(`webhook ${res.status}`);
    },
  };
}

export function telegramChannel(token: string, chatId: string, f: Fetch = fetch): NotifyChannel {
  registerExactSecret(token);
  return {
    name: "telegram",
    async send(text) {
      const res = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: clip(text, 4000), disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`telegram ${res.status}`);
    },
  };
}

export interface KakaoTokens {
  access_token: string;
  refresh_token: string;
  /** Epoch ms after which the access token is refreshed. */
  expires_at: number;
}

/** KakaoTalk text template limit. Longer messages are cut, so the first lines carry the point. */
export const KAKAO_TEXT_MAX = 200;
const KAKAO_SEND = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
export const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";

export function readKakaoTokens(file: string): KakaoTokens | null {
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<KakaoTokens>;
    if (typeof t.access_token !== "string" || typeof t.refresh_token !== "string") return null;
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Number(t.expires_at) || 0 };
  } catch {
    return null;
  }
}

export function writeKakaoTokens(file: string, t: KakaoTokens): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(t, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function kakaoChannel(opts: { restKey: string; clientSecret: string | null; tokenFile: string; linkUrl: string | null }, f: Fetch = fetch, now: () => number = Date.now): NotifyChannel {
  const link = opts.linkUrl ?? "http://127.0.0.1:7331/control";

  async function refresh(t: KakaoTokens): Promise<KakaoTokens> {
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: opts.restKey, refresh_token: t.refresh_token });
    if (opts.clientSecret) body.set("client_secret", opts.clientSecret);
    const res = await f(KAKAO_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
    if (!res.ok) throw new Error(`kakao 토큰 갱신 실패 ${res.status}: devhubctl kakao login 을 다시 실행하세요`);
    const j = (await res.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
    // Kakao returns a new refresh token only when the old one is close to expiring.
    const next: KakaoTokens = { access_token: j.access_token, refresh_token: j.refresh_token ?? t.refresh_token, expires_at: now() + Math.max(60, (j.expires_in ?? 21_600) - 300) * 1000 };
    writeKakaoTokens(opts.tokenFile, next);
    return next;
  }

  async function post(t: KakaoTokens, text: string): Promise<Response> {
    registerExactSecret(t.access_token);
    registerExactSecret(t.refresh_token);
    const template = { object_type: "text", text: clip(text, KAKAO_TEXT_MAX), link: { web_url: link, mobile_web_url: link }, button_title: "관제 열기" };
    return f(KAKAO_SEND, {
      method: "POST",
      headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }),
    });
  }

  return {
    name: "kakao",
    async send(text) {
      // Read every time: `devhubctl kakao login` may have replaced the file while the runner runs.
      let t = readKakaoTokens(opts.tokenFile);
      if (!t) throw new Error("kakao 로그인이 필요합니다: devhubctl kakao login");
      if (t.expires_at <= now()) t = await refresh(t);
      let res = await post(t, text);
      if (res.status === 401) res = await post(await refresh(t), text);
      if (!res.ok) throw new Error(`kakao ${res.status}`);
    },
  };
}

export function buildChannels(cfg: NotifyConfig, f: Fetch = fetch): NotifyChannel[] {
  const out: NotifyChannel[] = [];
  if (cfg.webhook) out.push(discordChannel(cfg.webhook, f));
  if (cfg.telegramToken && cfg.telegramChatId) out.push(telegramChannel(cfg.telegramToken, cfg.telegramChatId, f));
  if (cfg.kakaoRestKey) out.push(kakaoChannel({ restKey: cfg.kakaoRestKey, clientSecret: cfg.kakaoClientSecret, tokenFile: cfg.kakaoTokenFile, linkUrl: cfg.linkUrl }, f));
  return out;
}

export class Notifier {
  constructor(
    private channels: NotifyChannel[],
    private events: readonly NotifyEvent[] = NOTIFY_EVENTS,
    private onError: (channel: string, message: string) => void = () => {},
  ) {}

  get names(): string[] {
    return this.channels.map((c) => c.name);
  }

  get enabled(): boolean {
    return this.channels.length > 0;
  }

  wants(event: NotifyEvent): boolean {
    return this.enabled && this.events.includes(event);
  }

  /** Send to every channel. Never throws: each channel reports its own result. */
  async send(text: string): Promise<SendResult[]> {
    const masked = redactSecrets(text);
    return Promise.all(
      this.channels.map(async (c): Promise<SendResult> => {
        try {
          await c.send(masked);
          return { channel: c.name, ok: true };
        } catch (e) {
          const error = redactSecrets((e as Error).message).slice(0, 160);
          this.onError(c.name, error);
          return { channel: c.name, ok: false, error };
        }
      }),
    );
  }

  /** Send only when this kind of event is turned on. */
  async emit(event: NotifyEvent, text: string | null): Promise<void> {
    if (text && this.wants(event)) await this.send(text);
  }
}

// ---- message text ---------------------------------------------------------------------------

const STATE_LABEL: Record<string, string> = { starting: "시작 중", working: "작업 중", waiting_input: "입력 대기", idle: "대기", error: "오류", done: "완료", killed: "중단" };

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "1분 미만";
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

const folderName = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

export function formatStarted(s: SessionInfo): string {
  return [`[DevHub] 시작: ${s.name} (${s.preset})`, `폴더: ${folderName(s.cwd)}`, ...(s.goal ? [`목표: ${clip(s.goal, 120)}`] : [])].join("\n");
}

export function formatFinished(e: WorkLogEntry): string {
  const head = e.status === "exited" && (e.exitCode ?? 0) === 0 ? "완료" : e.status === "killed" ? "중단" : `실패${e.exitCode !== null ? ` (코드 ${e.exitCode})` : ""}`;
  const git = e.git && e.git.files.length ? `파일 ${e.git.files.length}개 (+${e.git.insertions} −${e.git.deletions})` : "파일 변경 없음";
  return [`[DevHub] ${head}: ${e.name}`, `${duration(e.endedAt - e.startedAt)} · ${git}`, ...(e.summary ? [clip(e.summary, 400)] : [])].join("\n");
}

export function formatReview(name: string, verdict: string, summary: string): string {
  return [`[DevHub] 교차검증 ${verdict}: ${name}`, ...(summary ? [clip(summary, 300)] : [])].join("\n");
}

/** Status of every running session, or null when nothing runs (no message then). */
export function formatDigest(sessions: SessionInfo[], now: number): string | null {
  const running = sessions.filter((s) => s.status === "running");
  if (!running.length) return null;
  const count = (state: string) => running.filter((s) => s.state === state).length;
  const parts = [`작업 중 ${count("working")}`, `입력 대기 ${count("waiting_input")}`];
  if (count("error")) parts.push(`오류 ${count("error")}`);
  const time = new Date(now).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  // Waiting sessions first: they are the ones that need the reader.
  const order = (s: SessionInfo) => (s.state === "waiting_input" ? 0 : s.state === "error" ? 1 : 2);
  const lines = [...running]
    .sort((a, b) => order(a) - order(b))
    .map((s) => `- ${s.name}: ${STATE_LABEL[s.state] ?? s.state}${s.stateReason ? `, ${clip(s.stateReason, 60)}` : ""} (${duration(now - s.createdAt)}째)`);
  return [`[DevHub] 진행 상황 ${time}`, parts.join(" · "), ...lines].join("\n");
}
