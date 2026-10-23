"use client";

import { useSyncExternalStore } from "react";
import type { ZoneId } from "@/data/species";

// "아니에요"를 누른 포획. 나중에 코엑스 전용 모델을 학습시킬 오답 데이터가 된다.
export interface MisidReport {
  at: number;
  predicted: string;
  rawClass: string;
  model: string | null;
  confidence: number;
  zone: ZoneId | null;
  photo: string | null;
}

const KEY = "coex-aqua-dex:misid:v1";
const EVENT = "aqua-misid-change";
export const MAX_REPORTS = 50;

let cachedRaw: string | null | undefined;
let cached: MisidReport[] = [];
const EMPTY: MisidReport[] = [];

function read(): MisidReport[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      cached = Array.isArray(parsed) ? parsed : [];
    } catch {
      cached = [];
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

export function useReports(): MisidReport[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function addReport(report: MisidReport) {
  const next = [report, ...read()].slice(0, MAX_REPORTS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.map((r) => ({ ...r, photo: null }))));
    } catch {}
  }
  window.dispatchEvent(new Event(EVENT));
}

export function downloadReports(reports: MisidReport[]) {
  const blob = new Blob([JSON.stringify(reports, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aqua-misid-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
