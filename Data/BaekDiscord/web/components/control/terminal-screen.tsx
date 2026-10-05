"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import type { SessionInfo } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { shortPath, stateMeta } from "./labels";

/** Keys Claude Code (and most TUIs) need that a phone keyboard can't type. */
const KEYS: Array<{ label: string; data: string; title: string }> = [
  { label: "Esc", data: "\u001b", title: "취소 / 중단 (Esc)" },
  { label: "⇧Tab", data: "\u001b[Z", title: "모드 전환: 자동 수락 · 계획 (Shift+Tab)" },
  { label: "↑", data: "\u001b[A", title: "위" },
  { label: "↓", data: "\u001b[B", title: "아래" },
  { label: "←", data: "\u001b[D", title: "왼쪽" },
  { label: "→", data: "\u001b[C", title: "오른쪽" },
  { label: "⏎", data: "\r", title: "Enter" },
  { label: "1", data: "1", title: "선택지 1" },
  { label: "2", data: "2", title: "선택지 2" },
  { label: "3", data: "3", title: "선택지 3" },
  { label: "Tab", data: "\t", title: "Tab" },
  { label: "^C", data: "\u0003", title: "Ctrl+C" },
];

const SLASH = ["/compact", "/clear", "/cost", "/model", "/resume", "/status", "/review", "/help"];

interface Props {
  session: SessionInfo;
  runner: RunnerApi;
  onClose: () => void;
}

/**
 * Full-screen terminal for one session, built for phones: the PTY screen, a row of TUI keys,
 * slash-command shortcuts and an IME-friendly composer (Korean input does not survive xterm on
 * mobile keyboards). A session started from a PC console (tag "pc") keeps the PC's size; this view
 * scales its font to fit instead of resizing the PTY under the PC user.
 */
export function TerminalScreen({ session: s, runner, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const [text, setText] = useState("");
  const [vh, setVh] = useState<number | null>(null);
  const mirrored = s.tags.includes("pc");
  const running = s.status === "running";
  const meta = stateMeta[s.state];
  const { subscribe, input, resize } = runner;
  const { id } = s;
  const sizeRef = useRef({ cols: s.cols, rows: s.rows, mirrored });
  useEffect(() => {
    sizeRef.current = { cols: s.cols, rows: s.rows, mirrored };
  }, [s.cols, s.rows, mirrored]);

  // Follow the on-screen keyboard: visualViewport shrinks when it opens, 100dvh does not on iOS.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setVh(vv.height);
    on();
    vv.addEventListener("resize", on);
    return () => vv.removeEventListener("resize", on);
  }, []);

  // Lock page scroll behind the overlay.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), Consolas, monospace",
        scrollback: 5000,
        theme: { background: "#0b0d10", foreground: "#e6e8eb", cursor: "#7c9cff", selectionBackground: "#2a3350" },
        allowProposedApi: true,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;
      fitRef.current = fit;
      term.onData((d) => input([id], d));
      unsubscribe = subscribe(id, (data) => term.write(data));
      layout();
      observer = new ResizeObserver(() => layout());
      observer.observe(hostRef.current);
    })();

    function layout() {
      const term = termRef.current;
      const host = hostRef.current;
      if (!term || !host) return;
      const { cols, rows, mirrored: pc } = sizeRef.current;
      if (pc) {
        // Same grid as the PC console; shrink the font until the columns fit the screen width.
        const width = host.clientWidth - 8;
        const size = Math.max(7, Math.min(13, Math.floor((width / (cols * 0.6)) * 10) / 10));
        if (term.options.fontSize !== size) term.options.fontSize = size;
        if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
        return;
      }
      try {
        fitRef.current?.fit();
        resize(id, term.cols, term.rows);
      } catch {
        /* host hidden */
      }
    }

    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [id, subscribe, input, resize]);

  // PC console resized: follow it.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !mirrored) return;
    const width = (hostRef.current?.clientWidth ?? 360) - 8;
    term.options.fontSize = Math.max(7, Math.min(13, Math.floor((width / (s.cols * 0.6)) * 10) / 10));
    term.resize(s.cols, s.rows);
  }, [mirrored, s.cols, s.rows]);

  function key(data: string) {
    if (!running) return;
    input([id], data);
  }

  function submit() {
    if (!running) return;
    const body = text.replace(/\r\n/g, "\n");
    if (!body) return key("\r");
    // Multi-line text goes in as a bracketed paste so Claude Code keeps it as one message.
    input([id], body.includes("\n") ? `\u001b[200~${body}\u001b[201~` : body);
    setTimeout(() => input([id], "\r"), 30);
    setText("");
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex flex-col bg-background" style={{ height: vh ? `${vh}px` : "100dvh" }} role="dialog" aria-label={`${s.name} 터미널`}>
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-sm">
        <button className="btn min-h-10 px-3" onClick={onClose}>
          닫기
        </button>
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot} ${s.state === "working" ? "animate-pulse" : ""}`} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-medium">{s.name}</div>
          <div className="truncate text-[11px] text-muted">
            {meta.label} · <span className="font-mono">{shortPath(s.cwd)}</span>
            {mirrored && (
              <>
                {" "}
                · PC 창과 공유 {s.cols}×{s.rows}
              </>
            )}
          </div>
        </div>
      </header>

      {s.suggestion && (
        <div className="flex items-center gap-2 border-b border-border bg-warn/5 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{s.suggestion.kind === "escalate" ? "확인 필요" : "제안"}</span> {s.suggestion.label}
          </span>
          {s.suggestion.kind === "respond" && (
            <button className="btn btn-primary min-h-9 px-2" onClick={() => runner.decideSuggestion(s.id, s.suggestion!.id, "approve")}>
              승인
            </button>
          )}
          <button className="btn min-h-9 px-2" onClick={() => runner.decideSuggestion(s.id, s.suggestion!.id, "dismiss")}>
            {s.suggestion.kind === "respond" ? "무시" : "확인"}
          </button>
        </div>
      )}

      <div ref={hostRef} className={`min-h-0 flex-1 bg-background p-1 ${mirrored ? "overflow-auto" : "overflow-hidden"}`} />

      <div className="border-t border-border bg-surface">
        <div className="flex gap-1 overflow-x-auto px-2 pt-2">
          {KEYS.map((k) => (
            <button key={k.label} className="btn min-h-10 min-w-11 shrink-0 px-2 font-mono text-sm" disabled={!running} title={k.title} onClick={() => key(k.data)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto px-2 pt-1.5">
          {SLASH.map((c) => (
            <button key={c} className="shrink-0 rounded px-2 py-1 font-mono text-xs text-muted hover:text-foreground" disabled={!running} onClick={() => setText(c)}>
              {c}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            className="input max-h-32 min-h-11 flex-1 resize-none py-2.5 text-[16px] leading-snug"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter is a newline. Phones use the button.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={running ? "메시지 (빈 칸으로 보내면 Enter)" : "세션이 종료됐습니다"}
            disabled={!running}
            enterKeyHint="send"
          />
          <button className="btn btn-primary min-h-11 shrink-0 px-4" type="submit" disabled={!running}>
            보내기
          </button>
        </form>
      </div>
    </div>
  );
}
