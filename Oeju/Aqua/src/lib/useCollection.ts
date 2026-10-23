"use client";

import { useSyncExternalStore } from "react";
import { addCapture, emptyCollection, parseCollection, type CaptureInput, type Collection } from "./collection";

const KEY = "coex-aqua-dex:v1";
const EVENT = "aqua-dex-change";

let cachedRaw: string | null | undefined;
let cached: Collection = emptyCollection;

function read(): Collection {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseCollection(raw);
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

export function useCollection(): Collection {
  return useSyncExternalStore(subscribe, read, () => emptyCollection);
}

export function saveCapture(input: CaptureInput) {
  const result = addCapture(read(), input);
  try {
    localStorage.setItem(KEY, JSON.stringify(result.collection));
  } catch {
    // 용량 초과면 사진 없이라도 저장
    const slim = {
      ...result.collection,
      caught: Object.fromEntries(
        Object.entries(result.collection.caught).map(([id, e]) => [id, { ...e, photo: null }]),
      ),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {}
  }
  window.dispatchEvent(new Event(EVENT));
  return result;
}

export function resetCollection() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}
