"use client";

export interface RunnerSettings {
  url: string;
  token: string;
}

const KEY = "devhub.runner";
export const DEFAULT_RUNNER_URL = "http://127.0.0.1:7331";

export function loadRunnerSettings(): RunnerSettings {
  if (typeof window === "undefined") return { url: DEFAULT_RUNNER_URL, token: "" };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RunnerSettings>;
      return { url: parsed.url || DEFAULT_RUNNER_URL, token: parsed.token || "" };
    }
  } catch {
    /* ignore */
  }
  return { url: DEFAULT_RUNNER_URL, token: "" };
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
  u.pathname = "/ws";
  u.search = `?token=${encodeURIComponent(s.token)}`;
  return u.toString();
}

export async function runnerFetch<T>(s: RunnerSettings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(new URL(path, s.url).toString(), {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${s.token}`, "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}
