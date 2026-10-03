"use client";

import { useEffect, useState } from "react";
import type { Policy, SessionInfo, WorkspaceInfo } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { TerminalTile } from "@/components/terminal-tile";
import { Sparkline } from "./sparkline";
import { fmtDuration, policyLabel, policyOptions, shortPath, stateMeta } from "./labels";

interface Props {
  session: SessionInfo;
  workspace: WorkspaceInfo | undefined;
  runner: RunnerApi;
}

export function SessionCard({ session: s, workspace, runner }: Props) {
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const [showWork, setShowWork] = useState(false);
  const [showTerm, setShowTerm] = useState(false);
  const [, tick] = useState(0);
  const meta = stateMeta[s.state];
  const running = s.status === "running";

  // Elapsed-time ticker for running sessions.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Workspace refresh while expanded.
  useEffect(() => {
    if (!showWork) return;
    runner.requestWorkspace(s.id);
    const t = setInterval(() => runner.requestWorkspace(s.id), 20_000);
    return () => clearInterval(t);
  }, [showWork, s.id, runner]);

  function sendQuick(data: string) {
    if (!running) return;
    runner.input([s.id], data);
  }

  const attention = s.state === "waiting_input" || s.state === "error" || s.suggestion !== null;

  return (
    <article className={`card overflow-hidden ${attention ? "border-warn/50" : ""}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot} ${s.state === "working" ? "animate-pulse" : ""}`} />
        <span className="font-medium">{s.name}</span>
        <span className="badge">{s.preset}</span>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
        <span className="ml-auto text-xs text-muted">
          {running ? fmtDuration(s.createdAt, null) : `${s.status}${s.exitCode !== null ? ` · code ${s.exitCode}` : ""}`}
        </span>
      </header>
      <div className="px-3 pb-1 text-xs text-muted">
        <span>{s.stateReason}</span>
        <span className="mx-1.5">·</span>
        <span className="font-mono" title={s.cwd}>
          {shortPath(s.cwd)}
        </span>
      </div>
      {s.lastLine && (
        <pre className="mx-3 mb-2 truncate rounded bg-background px-2 py-1 font-mono text-[11px] text-foreground/90" title={s.lastLine}>
          {s.lastLine}
        </pre>
      )}

      {s.suggestion && (
        <div className={`mx-3 mb-2 rounded-md border px-3 py-2 text-xs ${s.suggestion.kind === "escalate" ? "border-warn/60 bg-warn/5" : "border-accent/50 bg-accent/5"}`}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{s.suggestion.kind === "escalate" ? "사람 확인 필요" : "슈퍼바이저 제안"}</span>
            <span className="text-muted">
              {s.suggestion.source === "brain" ? "AI" : "규칙"} · 신뢰도 {Math.round(s.suggestion.confidence * 100)}%
            </span>
          </div>
          <div className="mt-1 text-foreground">{s.suggestion.label}</div>
          <div className="text-muted">{s.suggestion.rationale}</div>
          <div className="mt-2 flex gap-2">
            {s.suggestion.kind === "respond" && (
              <button className="btn btn-primary min-h-10" onClick={() => runner.decideSuggestion(s.id, s.suggestion!.id, "approve")}>
                승인
              </button>
            )}
            <button className="btn min-h-10" onClick={() => runner.decideSuggestion(s.id, s.suggestion!.id, "dismiss")}>
              {s.suggestion.kind === "respond" ? "무시" : "확인"}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-2 px-3 pb-2 sm:grid-cols-[1fr_auto]">
        <label className="min-w-0">
          <span className="label">목표</span>
          <input
            className="input min-h-10"
            value={goalDraft ?? s.goal ?? ""}
            placeholder="슈퍼바이저가 판단할 때 쓸 목표"
            onChange={(e) => setGoalDraft(e.target.value)}
            onBlur={() => {
              if (goalDraft !== null && goalDraft !== (s.goal ?? "")) runner.setGoal(s.id, goalDraft.trim() || null);
              setGoalDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
          />
        </label>
        <label>
          <span className="label">정책</span>
          <select className="input min-h-10 sm:w-28" value={s.policy} onChange={(e) => runner.setPolicy(s.id, e.target.value as Policy)}>
            {policyOptions.map((p) => (
              <option key={p} value={p}>
                {policyLabel[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form
        className="flex gap-2 px-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!quick.trim() && quick !== "") return;
          sendQuick(`${quick}\r`);
          setQuick("");
        }}
      >
        <input className="input min-h-10 font-mono" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="세션에 입력…" disabled={!running} enterKeyHint="send" />
        <button className="btn btn-primary min-h-10" type="submit" disabled={!running}>
          전송
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        <button className="btn min-h-9 px-2 text-xs" disabled={!running} onClick={() => sendQuick("y\r")}>
          y ⏎
        </button>
        <button className="btn min-h-9 px-2 text-xs" disabled={!running} onClick={() => sendQuick("\r")}>
          ⏎
        </button>
        <button className="btn min-h-9 px-2 text-xs" disabled={!running} onClick={() => sendQuick("\u0003")}>
          Ctrl+C
        </button>
        <button className="btn min-h-9 px-2 text-xs" disabled={!running} onClick={() => sendQuick("\u001b")}>
          Esc
        </button>
        <span className="ml-auto flex gap-1.5">
          <button className={`btn min-h-9 px-2 text-xs ${showWork ? "border-accent text-foreground" : ""}`} onClick={() => setShowWork((v) => !v)}>
            작업 현황
          </button>
          <button className={`btn min-h-9 px-2 text-xs ${showTerm ? "border-accent text-foreground" : ""}`} onClick={() => setShowTerm((v) => !v)}>
            터미널
          </button>
          <button className="btn btn-danger min-h-9 px-2 text-xs" onClick={() => (running ? runner.kill([s.id]) : runner.remove([s.id]))}>
            {running ? "종료" : "닫기"}
          </button>
        </span>
      </div>

      {showWork && <WorkspaceView workspace={workspace} />}
      {showTerm && (
        <div className="border-t border-border p-2">
          <TerminalTile session={s} runner={runner} selected={false} onToggleSelect={() => undefined} focused onFocus={() => undefined} />
        </div>
      )}
    </article>
  );
}

function WorkspaceView({ workspace }: { workspace: WorkspaceInfo | undefined }) {
  if (!workspace) {
    return <div className="border-t border-border px-3 py-2 text-xs text-muted">작업 현황을 불러오는 중…</div>;
  }
  const g = workspace.git;
  const files = g?.changed ?? [];
  const shown = files.slice(0, 20);
  return (
    <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
      <div>
        <div className="mb-1 flex items-center justify-between text-muted">
          <span>출력 활동 · 최근 30분</span>
          <span>{workspace.activity.reduce((a, b) => a + b, 0).toLocaleString()} bytes</span>
        </div>
        <Sparkline values={workspace.activity} height={28} title="세션 출력 활동" />
      </div>
      {g ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge font-mono">{g.branch}</span>
            {(g.ahead > 0 || g.behind > 0) && (
              <span className="text-muted">
                ↑{g.ahead} ↓{g.behind}
              </span>
            )}
            <span className="text-ok">+{g.insertions}</span>
            <span className="text-danger">-{g.deletions}</span>
            <span className="text-muted">변경 파일 {files.length}</span>
          </div>
          {shown.length > 0 && (
            <ul className="divide-y divide-border rounded border border-border">
              {shown.map((f) => (
                <li key={f.path} className="flex items-center gap-2 px-2 py-1 font-mono">
                  <span className={`w-5 shrink-0 ${f.status.includes("D") ? "text-danger" : f.status === "?" ? "text-muted" : "text-warn"}`}>{f.status}</span>
                  <span className="min-w-0 flex-1 truncate" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-ok">+{f.insertions}</span>
                  <span className="shrink-0 text-danger">-{f.deletions}</span>
                </li>
              ))}
              {files.length > shown.length && <li className="px-2 py-1 text-muted">+{files.length - shown.length}개 더</li>}
            </ul>
          )}
          {g.recentCommits.length > 0 && (
            <ul className="space-y-0.5">
              {g.recentCommits.map((c) => (
                <li key={c.sha} className="flex gap-2">
                  <span className="shrink-0 font-mono text-muted">{c.sha}</span>
                  <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                  <span className="shrink-0 text-muted">{c.when}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-muted">git 저장소가 아니거나 git을 읽을 수 없습니다.</p>
      )}
    </div>
  );
}
