"use client";

import { useState } from "react";
import type { TunnelStatus } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

/** True when this page was opened through the tunnel rather than on the PC itself. */
function viewedRemotely(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]";
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/** One line at the top of /control while the tunnel is open, so an open tunnel is never forgotten. */
export function TunnelBanner({ tunnel, runner }: { tunnel: TunnelStatus | null; runner: RunnerApi }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!tunnel || tunnel.state !== "running") return null;
  const remote = viewedRemotely();
  const running = runner.sessions.filter((s) => s.status === "running").length;
  const devices = tunnel.remoteClients;
  const closing = tunnel.closesAt ? `${clock(tunnel.closesAt)} 자동 닫힘` : devices > 0 ? "기기 연결 중" : "자동 닫힘 꺼짐";

  return (
    <section className="border-b border-border bg-surface px-3 py-1.5 text-xs" aria-label="원격 접속 상태">
      <button className="flex min-h-9 w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-ok" />
        <span className="font-medium text-foreground">원격 접속 열림</span>
        <span className="text-muted">
          기기 {devices} · {closing}
        </span>
        <span className="ml-auto text-muted">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="space-y-2 pb-1.5 pt-1">
          <p className="break-all font-mono text-muted">{tunnel.url}</p>
          {confirming ? (
            <div className="space-y-2">
              <p className="text-warn">
                {remote ? "이 기기도 끊기며 PC에서만 다시 열 수 있습니다. " : ""}
                실행 중 세션 {running}개.
              </p>
              <div className="flex gap-2">
                <button className="btn btn-danger min-h-11" onClick={() => runner.tunnelAction("stop")}>
                  터널 닫기 확인
                </button>
                <button className="btn min-h-11" onClick={() => setConfirming(false)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-danger min-h-11" disabled={runner.status !== "open"} onClick={() => (remote ? setConfirming(true) : runner.tunnelAction("stop"))}>
              터널 닫기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
