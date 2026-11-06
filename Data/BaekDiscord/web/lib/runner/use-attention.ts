"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "./protocol";
import type { RunnerApi } from "./use-runner";
import { attentionCount, diffNotices, shouldNotify, titleWithBadge, type Notice } from "./connection";
import { loadNotifyPrefs, saveNotifyPrefs, type NotifyPrefs } from "./notify-settings";

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

export interface AttentionApi {
  /** Running sessions that need a human (waiting for input, error, or a pending suggestion). */
  count: number;
  prefs: NotifyPrefs;
  setMode: (mode: NotifyPrefs["mode"]) => void;
  permission: NotifyPermission;
  requestPermission: () => Promise<void>;
}

/** Message the service worker posts when a notification action button is pressed. */
export interface NotificationActionMessage {
  type: "devhub:notification-action";
  sessionId: string;
  action: string;
}

/** Keystroke each notification action sends to the session (same buttons as the session card). */
export const ACTION_KEYS: Record<string, string> = { yes: "y\r", enter: "\r", esc: "\u001b" };

function hasActionButtons(kind: Notice["kind"]): boolean {
  return kind === "waiting";
}

async function showNotice(n: Notice): Promise<void> {
  const options: NotificationOptions & { actions?: Array<{ action: string; title: string }>; renotify?: boolean } = {
    body: n.body.slice(0, 200),
    tag: `devhub-session-${n.sessionId}`,
    icon: "/icons/icon-192.png",
    data: { sessionId: n.sessionId },
    renotify: true,
  };
  // Action buttons only exist on service-worker notifications (Chrome/Android); plain
  // Notification() is the fallback for dev/localhost where the worker is not registered.
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined;
  if (reg && "showNotification" in reg) {
    if (hasActionButtons(n.kind)) {
      options.actions = [
        { action: "yes", title: "y ⏎" },
        { action: "enter", title: "⏎" },
        { action: "esc", title: "Esc" },
      ];
    }
    await reg.showNotification(n.title, options);
    return;
  }
  const toast = new Notification(n.title, options);
  toast.onclick = () => {
    window.focus();
    toast.close();
  };
}

/**
 * Attention badge + system notifications for the control dashboard.
 * - Tab title "(N) …" and the PWA app badge follow the attention count (capped at 99+).
 * - A system notification fires when a session changes into a state that needs a human, but only
 *   while the dashboard is not in front, and only within the chosen quiet mode.
 * - Notification action buttons (y⏎ / ⏎ / Esc) come back through the service worker and are sent
 *   to the session as input.
 */
export function useAttention(runner: RunnerApi): AttentionApi {
  const { sessions, input } = runner;
  const [prefs, setPrefs] = useState<NotifyPrefs>(() => loadNotifyPrefs());
  const [permission, setPermission] = useState<NotifyPermission>(() => (typeof window !== "undefined" && "Notification" in window ? (Notification.permission as NotifyPermission) : "unsupported"));
  const prev = useRef<SessionInfo[] | null>(null);
  const baseTitle = useRef<string | null>(null);
  const count = attentionCount(sessions);

  // Tab title and app badge.
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title;
    document.title = titleWithBadge(baseTitle.current, count);
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) nav.setAppBadge?.(count).catch(() => undefined);
    else nav.clearAppBadge?.().catch(() => undefined);
    return () => {
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, [count]);

  // Transitions → notifications.
  useEffect(() => {
    const before = prev.current;
    prev.current = sessions;
    if (!before || permission !== "granted") return;
    for (const n of diffNotices(before, sessions)) {
      if (shouldNotify({ hidden: document.hidden, focused: document.hasFocus(), mode: prefs.mode, priority: n.priority })) void showNotice(n).catch(() => undefined);
    }
  }, [sessions, permission, prefs.mode]);

  // Action buttons pressed on a service-worker notification.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as Partial<NotificationActionMessage> | undefined;
      if (!d || d.type !== "devhub:notification-action" || typeof d.sessionId !== "string") return;
      const keys = ACTION_KEYS[d.action ?? ""];
      if (keys) input([d.sessionId], keys);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [input]);

  const setMode = useCallback((mode: NotifyPrefs["mode"]) => {
    const next = { mode };
    saveNotifyPrefs(next);
    setPrefs(next);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p as NotifyPermission);
    } catch {
      setPermission(Notification.permission as NotifyPermission);
    }
  }, []);

  return { count, prefs, setMode, permission, requestPermission };
}
