"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatTurn } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { fmtTime } from "./labels";

interface Props {
  runner: RunnerApi;
  className?: string;
}

export function ChatPanel({ runner, className = "" }: Props) {
  const { chat, chatBusy, supervisor, status } = runner;
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const noBrain = supervisor?.brain === "heuristic";

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, chatBusy]);

  function submit() {
    const t = text.trim();
    if (!t || chatBusy || status !== "open") return;
    runner.sendChat(t, confirm);
    setText("");
    setConfirm(false);
  }

  return (
    <section className={`card flex flex-col ${className}`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="font-medium">관제 AI</span>
        <span className="text-xs text-muted">{supervisor ? `${supervisor.brain}${supervisor.brainModel ? ` · ${supervisor.brainModel}` : ""}` : ""}</span>
        <button className="btn ml-auto px-2 py-1 text-[11px]" onClick={runner.resetChat} disabled={chatBusy}>
          초기화
        </button>
      </div>
      <div ref={listRef} className="min-h-[200px] flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm lg:max-h-[520px]">
        {chat.length === 0 && (
          <p className="text-xs text-muted">
            {noBrain
              ? "판단 엔진이 없어 관제 AI를 쓸 수 없습니다. 러너에 ANTHROPIC_API_KEY를 주거나 Claude Code CLI를 설치하세요."
              : "예: “RunClue 폴더에서 테스트 돌리고 실패 원인 요약해줘”, “입력 대기 중인 세션에 y 보내”"}
          </p>
        )}
        {chat.map((t) => (
          <Turn key={t.id} turn={t} />
        ))}
        {chatBusy && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
            관제 AI가 생각하는 중…
          </div>
        )}
      </div>
      <div className="border-t border-border px-3 py-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className="input min-h-11"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={noBrain ? "판단 엔진 없음" : "세션에 내릴 지시…"}
            disabled={chatBusy || noBrain || status !== "open"}
            enterKeyHint="send"
          />
          <button className="btn btn-primary min-h-11 whitespace-nowrap" type="submit" disabled={chatBusy || noBrain || status !== "open" || !text.trim()}>
            전송
          </button>
        </form>
        <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="h-4 w-4 accent-accent" />
          확인하고 실행 (삭제·force push 같은 파괴적 명령도 허용)
        </label>
      </div>
    </section>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const [showActions, setShowActions] = useState(false);
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] rounded-lg px-3 py-2 ${mine ? "bg-accent-strong/30" : "bg-surface-2"}`}>
        <div className="whitespace-pre-wrap break-words">{turn.text}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <span>{fmtTime(turn.ts)}</span>
          {!mine && turn.actions && turn.actions.length > 0 && (
            <button className="underline" onClick={() => setShowActions((v) => !v)}>
              도구 {turn.actions.length}회
            </button>
          )}
        </div>
        {showActions && turn.actions && (
          <ul className="mt-1 space-y-1 border-t border-border pt-1 text-[11px]">
            {turn.actions.map((a, i) => (
              <li key={i} className="font-mono">
                <span className="text-accent">{a.tool}</span> <span className="text-muted">{JSON.stringify(a.args).slice(0, 120)}</span>
                <div className="whitespace-pre-wrap break-words text-muted">{a.result.slice(0, 200)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
