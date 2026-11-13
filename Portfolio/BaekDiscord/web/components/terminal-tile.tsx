"use client";

import { useEffect, useRef } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import type { SessionInfo } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

interface Props {
  session: SessionInfo;
  runner: RunnerApi;
  selected: boolean;
  onToggleSelect: () => void;
  focused: boolean;
  onFocus: () => void;
}

const statusColor: Record<SessionInfo["status"], string> = {
  running: "bg-ok",
  exited: "bg-muted",
  killed: "bg-warn",
  error: "bg-danger",
};

function fmtDuration(from: number, to: number | null): string {
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function TerminalTile({ session, runner, selected, onToggleSelect, focused, onFocus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const { id, status } = session;
  const { subscribe, input, resize } = runner;

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), Consolas, monospace",
        scrollback: 4000,
        theme: { background: "#0b0d10", foreground: "#e6e8eb", cursor: "#7c9cff", selectionBackground: "#2a3350" },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      term.onData((d) => input([id], d));
      term.onResize(({ cols, rows }) => resize(id, cols, rows));
      const doFit = () => {
        try {
          fit.fit();
        } catch {
          /* host hidden */
        }
      };
      doFit();
      observer = new ResizeObserver(doFit);
      observer.observe(hostRef.current);
      unsubscribe = subscribe(id, (data) => term.write(data));
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [id, subscribe, input, resize]);

  useEffect(() => {
    if (focused) termRef.current?.focus();
  }, [focused]);

  return (
    <div
      className={`card flex min-h-[320px] flex-col overflow-hidden ${focused ? "border-accent" : ""}`}
      onMouseDown={onFocus}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onMouseDown={(e) => e.stopPropagation()}
          title="브로드캐스트 대상"
          className="accent-accent"
        />
        <span className={`inline-block h-2 w-2 rounded-full ${statusColor[status]}`} />
        <span className="font-medium text-foreground">{session.name}</span>
        <span className="badge">{session.preset}</span>
        <span className="truncate text-muted" title={session.cwd}>
          {session.cwd}
        </span>
        <span className="ml-auto whitespace-nowrap text-muted">
          {status === "running" ? fmtDuration(session.createdAt, null) : `${status}${session.exitCode !== null ? ` · code ${session.exitCode}` : ""}`}
        </span>
        <button
          className="btn px-2 py-0.5 text-[11px] btn-danger"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => (status === "running" ? runner.kill([id]) : runner.remove([id]))}
        >
          {status === "running" ? "종료" : "닫기"}
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-background p-1" />
    </div>
  );
}
