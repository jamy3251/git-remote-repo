"use client";

import { useSyncExternalStore } from "react";

export type CheckinMethod = "gps" | "qr";

export interface Visits {
  /** "YYYY-MM-DD" -> 확인 방법 */
  days: Record<string, CheckinMethod>;
}

const KEY = "coex-aqua-dex:visits:v1";
const EVENT = "aqua-visits-change";
const EMPTY: Visits = { days: {} };

let cachedRaw: string | null | undefined;
let cached: Visits = EMPTY;

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function read(): Visits {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const v = raw ? JSON.parse(raw) : EMPTY;
      cached = v && typeof v.days === "object" ? v : EMPTY;
    } catch {
      cached = EMPTY;
    }
  }
  return cached;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useVisits(): Visits {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function recordVisit(method: CheckinMethod, at = new Date()) {
  const v = read();
  const key = dayKey(at);
  // 같은 날 GPS로 확인했으면 QR 기록으로 덮지 않는다 (어느 쪽이든 방문은 방문)
  if (v.days[key]) return;
  const next: Visits = { days: { ...v.days, [key]: method } };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** 오늘 현장에 있는가 (포획 보너스·현장 배지) */
export function isOnSiteToday(v: Visits, today: Date | null): boolean {
  return !!today && !!v.days[dayKey(today)];
}
