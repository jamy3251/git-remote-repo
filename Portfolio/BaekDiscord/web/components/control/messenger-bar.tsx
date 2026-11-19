"use client";

import { useEffect, useState } from "react";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { runnerFetch } from "@/lib/runner/settings";
import { channelLabel, eventsText, resultLines, type MessengerSendResult, type MessengerStatus, type ResultLine } from "@/lib/runner/messenger";

type Load = { state: "loading" } | { state: "ready"; status: MessengerStatus } | { state: "error"; message: string };

/**
 * Messenger notifications the runner sends (KakaoTalk, Telegram, Discord): which channels are on,
 * what is sent, and two buttons to try them. Channels are set with environment variables on the PC,
 * so this bar only shows and tests them.
 */
export function MessengerBar({ runner }: { runner: RunnerApi }) {
  const { settings, status, info } = runner;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<"test" | "digest" | null>(null);
  const [lines, setLines] = useState<ResultLine[]>([]);
  const open = status === "open";
  const demo = info?.demo === true;

  useEffect(() => {
    if (!open || demo) return;
    let stale = false;
    runnerFetch<MessengerStatus>(settings, "/notify")
      .then((s) => !stale && setLoad({ state: "ready", status: s }))
      .catch((e: Error) => !stale && setLoad({ state: "error", message: e.message }));
    return () => {
      stale = true;
    };
  }, [open, demo, settings]);

  // The demo runner has no HTTP API and sends nothing.
  if (demo) return null;

  async function send(kind: "test" | "digest") {
    setBusy(kind);
    setLines([]);
    try {
      const r = await runnerFetch<{ results: MessengerSendResult[]; sent?: boolean }>(settings, `/notify/${kind}`, { method: "POST" });
      setLines(resultLines(r.results, r.sent ?? true));
    } catch (e) {
      setLines([{ text: (e as Error).message, ok: false }]);
    } finally {
      setBusy(null);
    }
  }

  const ready = open && load.state === "ready" ? load.status : null;
  const on = ready !== null && ready.channels.length > 0;

  return (
    <section className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
      <span className="font-medium">메신저 알림</span>
      {!open && <span className="text-xs text-muted">러너에 연결되면 표시됩니다</span>}
      {open && load.state === "loading" && <span className="text-xs text-muted">확인 중…</span>}
      {open && load.state === "error" && <span className="text-xs text-danger">상태를 읽지 못했습니다: {load.message}</span>}
      {ready && !on && (
        <span className="text-xs text-muted">
          꺼짐 · PC의 러너 환경 변수에 채널을 넣고 러너를 다시 시작하면 켜집니다 (<span className="font-mono">docs/notify.md</span>)
        </span>
      )}
      {ready && on && (
        <>
          <span className="text-xs text-ok">{ready.channels.map(channelLabel).join(" · ")}</span>
          <span className="text-xs text-muted" title="러너가 메신저로 보내는 일. NOTIFY_EVENTS와 NOTIFY_DIGEST_MIN으로 바꿉니다.">
            {eventsText(ready)}
          </span>
          <span className="flex flex-wrap gap-2 sm:ml-auto">
            <button className="btn min-h-9 text-xs" disabled={busy !== null} onClick={() => void send("test")}>
              {busy === "test" ? "보내는 중…" : "시험 보내기"}
            </button>
            <button className="btn min-h-9 text-xs" disabled={busy !== null} onClick={() => void send("digest")} title="실행 중인 세션의 상태를 지금 메신저로 보냅니다">
              {busy === "digest" ? "보내는 중…" : "진행 상황 보내기"}
            </button>
          </span>
        </>
      )}
      {lines.length > 0 && (
        <div className="flex w-full flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs" role="status">
          {lines.map((l) => (
            <span key={l.text} className={l.ok ? "text-muted" : "text-danger"}>
              {l.text}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
