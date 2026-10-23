"use client";

import { useSyncExternalStore } from "react";

// 서버 렌더에서는 날짜를 모르므로 null. 클라이언트에서만 오늘 날짜를 쓴다.
let cachedKey = "";
let cachedDate: Date | null = null;

function snapshot(): Date | null {
  const now = new Date();
  const key = now.toDateString();
  if (key !== cachedKey) {
    cachedKey = key;
    cachedDate = now;
  }
  return cachedDate;
}

const noop = () => () => {};

export function useToday(): Date | null {
  return useSyncExternalStore(noop, snapshot, () => null);
}
