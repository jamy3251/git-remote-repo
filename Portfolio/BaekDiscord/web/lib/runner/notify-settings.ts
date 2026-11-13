"use client";

import type { NotifyMode } from "./connection";

export interface NotifyPrefs {
  mode: NotifyMode;
}

const KEY = "devhub.notify";
export const DEFAULT_NOTIFY: NotifyPrefs = { mode: "all" };

export const notifyModeLabel: Record<NotifyMode, string> = { all: "모두 알림", priority: "확인 필요만", off: "방해 금지" };
export const notifyModes: NotifyMode[] = ["all", "priority", "off"];

export function loadNotifyPrefs(): NotifyPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIFY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<NotifyPrefs>;
      if (p.mode === "all" || p.mode === "priority" || p.mode === "off") return { mode: p.mode };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_NOTIFY;
}

export function saveNotifyPrefs(p: NotifyPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
