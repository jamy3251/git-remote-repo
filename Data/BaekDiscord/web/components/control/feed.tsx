"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatTurn, SessionInfo, WorkLogEntry } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { needsAttention, shortPath, stateMeta } from "./labels";

interface Props {
  runner: RunnerApi;
  onOpenTerminal: (id: string) => void;
  onOpenLog?: () => void;
  className?: string;
}

type Item =
  | { kind: "turn"; ts: number; key: string; turn: ChatTurn }
  | { kind: "started"; ts: number; key: string; session: SessionInfo }
  | { kind: "finished"; ts: number; key: string; entry: WorkLogEntry };

const QUICK = ["지금 켜진 폴더랑 상태 알려줘", "오늘 끝난 작업 정리해줘", "입력 기다리는 세션 처리해줘"];
const DAY = 24 * 3600_000;

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Messenger-style control: talk to the control AI, and see sessions start, finish and ask for
 * input in the same timeline. Sessions waiting for a human stay pinned above the composer.
 */
export function Feed({ runner, onOpenTerminal, onOpenLog, className = "" }: Props) {
  const { chat, chatBusy, supervisor, status, sessions, worklog } = runner;
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const noBrain = supervisor?.brain === "heuristic";
  const [since] = useState(() => Date.now() - DAY);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = chat.map((t) => ({ kind: "turn", ts: t.ts, key: `t${t.id}`, turn: t }));
    for (const s of sessions) if (s.createdAt >= since) out.push({ kind: "started", ts: s.createdAt, key: `s${s.id}`, session: s });
    for (const e of worklog) if (e.endedAt >= since) out.push({ kind: "finished", ts: e.endedAt, key: `f${e.id}`, entry: e });
    return out.sort((a, b) => a.ts - b.ts).slice(-150);
  }, [chat, sessions, worklog, since]);

  const pinned = sessions.filter((s) => s.status === "running" && needsAttention(s));

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, chatBusy]);

  function submit(value = text) {
    const t = value.trim();
    if (!t || chatBusy || status !== "open" || noBrain) return;
    runner.sendChat(t, confirm);
    setText("");
    setConfirm(false);
  }

  return (
    <section className={`flex min-h-0 flex-col ${className}`}>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <div className="mx-auto max-w-sm py-10 text-center text-sm text-muted">
            {noBrain ? (
              "판단 엔진이 없어 대화로 지시할 수 없습니다. 러너 PC에 Claude Code CLI를 설치하거나 ANTHROPIC_API_KEY를 설정하세요."
            ) : (
              <>
                <p className="text-foreground">PC에서 하던 일을 여기서 시키세요.</p>
                <p className="mt-1">폴더를 몰라도 됩니다. “RunClue 테스트 돌리고 실패 원인 알려줘”처럼 말하면 관제 AI가 세션을 띄우고 결과를 알려줍니다.</p>
              </>
            )}
          </div>
        )}
        {items.map((it) =>
          it.kind === "turn" ? (
            <Bubble key={it.key} turn={it.turn} />
          ) : it.kind === "started" ? (
            <Notice key={it.key} ts={it.ts}>
              <button className="text-left hover:text-foreground" onClick={() => onOpenTerminal(it.session.id)}>
                <span className="text-foreground">{it.session.name}</span> 시작 · <span className="font-mono">{shortPath(it.session.cwd, 28)}</span>
              </button>
            </Notice>
          ) : (
            <Finished key={it.key} entry={it.entry} onOpenLog={onOpenLog} />
          ),
        )}
        {chatBusy && (
          <div className="flex items-center gap-2 pl-1 text-xs text-muted">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
            관제 AI가 처리하는 중
          </div>
        )}
      </div>

      {pinned.length > 0 && (
        <div className="max-h-[40%] space-y-2 overflow-y-auto border-t border-warn/30 bg-warn/[0.04] px-3 py-2">
          {pinned.map((s) => (
            <Attention key={s.id} session={s} runner={runner} onOpenTerminal={onOpenTerminal} />
          ))}
        </div>
      )}

      <div className="border-t border-border bg-surface px-3 pb-2 pt-2">
        {!text && !chatBusy && !noBrain && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto">
            {QUICK.map((q) => (
              <button key={q} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-foreground" disabled={status !== "open"} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
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
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={noBrain ? "판단 엔진 없음" : status === "open" ? "무엇을 시킬까요?" : "러너 연결 대기"}
            disabled={chatBusy || noBrain || status !== "open"}
            enterKeyHint="send"
          />
          <button className="btn btn-primary min-h-11 shrink-0 px-4" type="submit" disabled={chatBusy || noBrain || status !== "open" || !text.trim()}>
            보내기
          </button>
        </form>
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
            파괴적 명령 허용
          </label>
          {chat.length > 0 && (
            <button className="ml-auto hover:text-foreground" onClick={runner.resetChat} disabled={chatBusy}>
              대화 지우기
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Notice({ ts, children }: { ts: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted">
      <span className="h-px flex-1 bg-border" />
      <span className="max-w-[80%] truncate">{children}</span>
      <span>{clock(ts)}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Finished({ entry: e, onOpenLog }: { entry: WorkLogEntry; onOpenLog?: () => void }) {
  const ok = e.status === "exited" && e.exitCode === 0;
  const failed = e.status === "error" || (e.status === "exited" && e.exitCode !== 0 && e.exitCode !== null);
  return (
    <div className="flex justify-start">
      <button className={`max-w-[92%] rounded-lg border px-3 py-2 text-left ${failed ? "border-danger/40" : ok ? "border-ok/30" : "border-border"} bg-surface-2`} onClick={onOpenLog}>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={failed ? "text-danger" : ok ? "text-ok" : "text-muted"}>{failed ? "실패" : ok ? "완료" : "종료"}</span>
          <span className="font-medium text-foreground">{e.name}</span>
          <span className="text-muted">{clock(e.endedAt)}</span>
        </div>
        <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-foreground/90">{e.summary}</p>
      </button>
    </div>
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const [showActions, setShowActions] = useState(false);
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${mine ? "rounded-br-md bg-accent-strong text-white" : "rounded-bl-md bg-surface-2"}`}>
        <div className="whitespace-pre-wrap break-words">{turn.text}</div>
        <div className={`mt-0.5 flex items-center gap-2 text-[10px] ${mine ? "justify-end text-white/70" : "text-muted"}`}>
          {!mine && turn.actions && turn.actions.length > 0 && (
            <button className="underline-offset-2 hover:underline" onClick={() => setShowActions((v) => !v)}>
              실행 {turn.actions.length}단계
            </button>
          )}
          <span>{clock(turn.ts)}</span>
        </div>
        {showActions && turn.actions && (
          <ul className="mt-1 space-y-1 border-t border-border pt-1 text-[11px]">
            {turn.actions.map((a, i) => (
              <li key={i} className="font-mono">
                <span className="text-accent">{a.tool}</span> <span className="text-muted">{JSON.stringify(a.args).slice(0, 100)}</span>
                <div className="line-clamp-3 whitespace-pre-wrap break-words text-muted">{a.result.slice(0, 240)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Attention({ session: s, runner, onOpenTerminal }: { session: SessionInfo; runner: RunnerApi; onOpenTerminal: (id: string) => void }) {
  const meta = stateMeta[s.state];
  const sug = s.suggestion;
  return (
    <div className="rounded-lg border border-warn/40 bg-surface px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="font-medium">{s.name}</span>
        <span className={meta.cls.split(" ")[0]}>{meta.label}</span>
        <button className="ml-auto text-muted hover:text-foreground" onClick={() => onOpenTerminal(s.id)}>
          화면 보기
        </button>
      </div>
      <p className="mt-1 line-clamp-2 font-mono text-[11px] text-foreground/80">{sug ? `${sug.label} — ${sug.rationale}` : s.lastLine || s.stateReason}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sug?.kind === "respond" && (
          <button className="btn btn-primary min-h-9 text-xs" onClick={() => runner.decideSuggestion(s.id, sug.id, "approve")}>
            승인
          </button>
        )}
        {sug && (
          <button className="btn min-h-9 text-xs" onClick={() => runner.decideSuggestion(s.id, sug.id, "dismiss")}>
            {sug.kind === "respond" ? "무시" : "확인함"}
          </button>
        )}
        <button className="btn min-h-9 font-mono text-xs" onClick={() => runner.input([s.id], "1")} title="선택지 1">
          1
        </button>
        <button className="btn min-h-9 font-mono text-xs" onClick={() => runner.input([s.id], "y\r")}>
          y ⏎
        </button>
        <button className="btn min-h-9 font-mono text-xs" onClick={() => runner.input([s.id], "\r")}>
          ⏎
        </button>
        <button className="btn min-h-9 font-mono text-xs" onClick={() => runner.input([s.id], "\u001b")}>
          Esc
        </button>
      </div>
    </div>
  );
}
