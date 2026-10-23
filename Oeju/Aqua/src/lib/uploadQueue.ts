"use client";

import { useSyncExternalStore } from "react";
import type { ZoneId } from "@/data/species";

// 학습용 사진 업로드 대기열. 지하 수조 구역은 신호가 약하므로
// 바로 못 보내면 기기에 잠깐 두었다가 연결이 돌아오면 다시 보낸다.

export interface UploadItem {
  id: string;
  kind: "misid" | "field";
  image: string;
  zone: ZoneId | null;
  predicted?: string | null;
  rawClass?: string | null;
  model?: string | null;
  confidence?: number | null;
  actual?: string | null;
  clip?: string | null;
  tries: number;
}

export interface QueueState {
  pending: number;
  sent: number;
  failed: number;
  sending: boolean;
}

const KEY = "coex-aqua-dex:upload-queue:v1";
const MAX_ITEMS = 15;
const MAX_TRIES = 5;

let state: QueueState = { pending: 0, sent: 0, failed: 0, sending: false };
const listeners = new Set<() => void>();
let fieldKey: string | null = null;

function emit(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function load(): UploadItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function store(items: UploadItem[]) {
  // 용량이 넘치면 오래된 것부터 버린다 (사진이 커서 localStorage 5MB 를 금방 채운다)
  let list = items.slice(-MAX_ITEMS);
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      break;
    } catch {
      list = list.slice(1);
    }
  }
  if (!list.length) {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }
  emit({ pending: list.length });
}

export function setFieldKey(key: string | null) {
  fieldKey = key;
}

export function enqueueUpload(item: Omit<UploadItem, "id" | "tries">) {
  store([...load(), { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tries: 0 }]);
  void flushUploads();
}

/** 하나씩 보낸다. 네트워크·서버 오류면 멈추고 다음 기회에, 거절(4xx)이면 버린다 */
export async function flushUploads(): Promise<void> {
  if (state.sending || typeof navigator === "undefined" || navigator.onLine === false) return;
  emit({ sending: true });
  try {
    for (;;) {
      const items = load();
      const item = items[0];
      if (!item) break;
      let res: Response | null = null;
      try {
        res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(fieldKey ? { "x-field-key": fieldKey } : {}) },
          body: JSON.stringify(item),
        });
      } catch {
        res = null;
      }
      const rest = load().filter((i) => i.id !== item.id);
      if (res?.ok) {
        store(rest);
        emit({ sent: state.sent + 1 });
        continue;
      }
      const retryable = !res || res.status >= 500 || res.status === 429;
      if (retryable && item.tries + 1 < MAX_TRIES) {
        store([...rest, { ...item, tries: item.tries + 1 }]);
        break;
      }
      store(rest);
      emit({ failed: state.failed + 1 });
    }
  } finally {
    emit({ sending: false, pending: load().length });
  }
}

let started = false;
/** 앱이 열릴 때·연결이 돌아올 때 남은 사진을 보낸다 */
export function startUploadQueue() {
  if (started || typeof window === "undefined") return;
  started = true;
  emit({ pending: load().length });
  window.addEventListener("online", () => void flushUploads());
  void flushUploads();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const SERVER: QueueState = { pending: 0, sent: 0, failed: 0, sending: false };
export function useUploadQueue(): QueueState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}
