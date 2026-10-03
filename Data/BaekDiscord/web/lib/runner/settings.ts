"use client";

export interface RunnerSettings {
  url: string;
  token: string;
}

const KEY = "devhub.runner";
export const DEFAULT_RUNNER_URL = "http://127.0.0.1:7331";
export const API_PREFIX = "/runner";

/**
 * When the dashboard is served through the runner's proxy (same origin, e.g. via a tunnel on a
 * phone) the runner is simply the page origin. Only the bare Next dev/prod port needs the default.
 */
export function inferRunnerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_RUNNER_URL;
  const { protocol, hostname, port, origin } = window.location;
  const isNextPort = port === "3000" || (hostname === "localhost" && port === "") || (protocol === "http:" && port === "" && hostname === "127.0.0.1");
  return isNextPort ? DEFAULT_RUNNER_URL : origin;
}

/** A `#rt=<token>` fragment (from the tunnel QR code) is consumed once and stored, then removed from the URL. */
function consumeHashToken(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/(?:^#|&)rt=([^&]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
  return token;
}

export function loadRunnerSettings(): RunnerSettings {
  if (typeof window === "undefined") return { url: DEFAULT_RUNNER_URL, token: "" };
  let saved: Partial<RunnerSettings> = {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as Partial<RunnerSettings>;
  } catch {
    /* ignore */
  }
  const hashToken = consumeHashToken();
  const inferred = inferRunnerUrl();
  // A scanned QR always targets the origin it was scanned from, so prefer the page origin then.
  const url = hashToken ? inferred : saved.url || inferred;
  const settings = { url, token: hashToken ?? saved.token ?? "" };
  if (hashToken) saveRunnerSettings(settings);
  return settings;
}

export function saveRunnerSettings(s: RunnerSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function wsUrl(s: RunnerSettings): string {
  const u = new URL(s.url);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `${API_PREFIX}/ws`;
  u.search = `?token=${encodeURIComponent(s.token)}`;
  u.hash = "";
  return u.toString();
}

export async function runnerFetch<T>(s: RunnerSettings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(`${API_PREFIX}${path}`, s.url).toString(), {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${s.token}`, "content-type": "application/json", "ngrok-skip-browser-warning": "1" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}
