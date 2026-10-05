"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { Policy, WorkLogEntry } from "@/lib/runner/protocol";
import { useRunner, type RunnerApi } from "@/lib/runner/use-runner";
import { RunnerSettingsBar } from "@/components/runner-settings-bar";
import { Overview } from "@/components/control/overview";
import { RemotePanel } from "@/components/control/remote-panel";
import { NewTaskForm, type TaskDraft } from "@/components/control/new-task-form";
import { SessionCard } from "@/components/control/session-card";
import { Feed } from "@/components/control/feed";
import { WorkLogView } from "@/components/control/worklog-view";
import { TerminalScreen } from "@/components/control/terminal-screen";
import { EventLog } from "@/components/control/event-log";
import { needsAttention, policyLabel, policyOptions } from "@/components/control/labels";

type Filter = "all" | "running" | "attention";
type Tab = "chat" | "sessions" | "new" | "log";

const DESKTOP = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(DESKTOP);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
}

export function ControlView() {
  const runner = useRunner();
  const desktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>("chat");
  const [termId, setTermId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const termSession = termId ? runner.sessions.find((s) => s.id === termId) : undefined;

  const reuse = (e: WorkLogEntry) => {
    setDraft({ cwd: e.cwd, prompt: e.prompt ?? e.goal ?? "", goal: e.goal ?? undefined, nonce: Date.now() });
    setTab("new");
  };

  const terminal = termSession ? <TerminalScreen session={termSession} runner={runner} onClose={() => setTermId(null)} /> : null;

  if (!desktop) {
    return (
      <>
        <MobileShell runner={runner} tab={tab} setTab={setTab}>
          {tab === "chat" && <Feed runner={runner} onOpenTerminal={setTermId} onOpenLog={() => setTab("log")} className="h-full" />}
          {tab === "sessions" && (
            <div className="h-full space-y-3 overflow-y-auto px-3 py-3">
              <SessionsSection runner={runner} />
              <SupervisorBar runner={runner} />
              <RemotePanel tunnel={runner.tunnel} runner={runner} defaultOpen={false} />
              <RunnerSettingsBar settings={runner.settings} status={runner.status} onSave={runner.updateSettings} onConnect={runner.connect} error={runner.lastError} />
              <EventLog events={runner.events} sessions={runner.sessions} />
            </div>
          )}
          {tab === "new" && (
            <div className="h-full overflow-y-auto px-3 py-3">
              <NewTaskForm runner={runner} draft={draft} collapsible={false} onStarted={() => setTab("sessions")} />
            </div>
          )}
          {tab === "log" && (
            <div className="h-full overflow-y-auto px-3 py-3">
              <WorkLogView runner={runner} onReuse={reuse} />
            </div>
          )}
        </MobileShell>
        {terminal}
      </>
    );
  }

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">관제</h1>
          <p className="text-sm text-muted">에이전트 세션을 한눈에 보고, 대화로 지시하고, 끝난 작업을 돌아봅니다.</p>
        </div>
      </div>

      <RunnerSettingsBar settings={runner.settings} status={runner.status} onSave={runner.updateSettings} onConnect={runner.connect} error={runner.lastError} />
      <SupervisorBar runner={runner} />
      <Overview sessions={runner.sessions} workspaces={runner.workspaces} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <NewTaskForm runner={runner} draft={draft} />
          <RemotePanel tunnel={runner.tunnel} runner={runner} />
          <SessionsSection runner={runner} />
          <EventLog events={runner.events} sessions={runner.sessions} />
        </div>
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="card flex h-[min(640px,calc(100vh-7rem))] flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
              <span className="font-medium">대화</span>
              <span className="text-xs text-muted">
                관제 AI · {runner.supervisor?.brain ?? "-"}
                {runner.supervisor?.brainModel ? ` · ${runner.supervisor.brainModel}` : ""}
              </span>
            </div>
            <Feed runner={runner} onOpenTerminal={setTermId} className="min-h-0 flex-1" />
          </div>
          <WorkLogView runner={runner} onReuse={reuse} className="max-h-[70vh] overflow-y-auto" />
        </div>
      </div>
      {terminal}
    </div>
  );
}

function MobileShell({ runner, tab, setTab, children }: { runner: RunnerApi; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  const attention = runner.sessions.filter((s) => s.status === "running" && needsAttention(s)).length;
  const running = runner.sessions.filter((s) => s.status === "running").length;
  const conn =
    runner.status === "open"
      ? { text: "연결됨", cls: "bg-ok" }
      : runner.status === "connecting"
        ? { text: "연결 중", cls: "bg-warn animate-pulse" }
        : runner.status === "unauthorized"
          ? { text: "토큰 오류", cls: "bg-danger" }
          : { text: "끊김", cls: "bg-danger" };
  const tabs: Array<{ id: Tab; label: string; badge?: number; warn?: boolean }> = [
    { id: "chat", label: "대화" },
    { id: "sessions", label: "세션", badge: attention || running || undefined, warn: attention > 0 },
    { id: "new", label: "새 작업" },
    { id: "log", label: "내역" },
  ];
  const titles: Record<Tab, string> = { chat: "관제", sessions: "세션", new: "새 작업", log: "작업 내역" };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-base font-semibold">{titles[tab]}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${conn.cls}`} />
          {conn.text}
          {runner.status === "open" && running > 0 && <span>· 실행 {running}</span>}
        </span>
        {runner.status !== "open" && runner.status !== "connecting" && (
          <button className="btn min-h-9 px-2 text-xs" onClick={runner.connect}>
            다시 연결
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
      <nav className="grid grid-cols-4 border-t border-border bg-surface" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="관제 메뉴">
        {tabs.map((t) => (
          <button key={t.id} className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[13px] ${tab === t.id ? "text-foreground" : "text-muted"}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            {tab === t.id && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" />}
            <span className="font-medium">{t.label}</span>
            {t.badge ? <span className={`absolute right-[22%] top-2 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 ${t.warn ? "bg-warn text-black" : "bg-surface-2 text-muted"}`}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

function SupervisorBar({ runner }: { runner: RunnerApi }) {
  const { supervisor, status } = runner;
  const usage = supervisor?.usage;
  return (
    <section className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={supervisor?.enabled ?? false}
          disabled={!supervisor || status !== "open"}
          onChange={(e) => runner.setSupervisor({ enabled: e.target.checked })}
        />
        <span className="font-medium">슈퍼바이저</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        기본 정책
        <select
          className="input min-h-9 w-auto"
          value={supervisor?.defaultPolicy ?? "assist"}
          disabled={!supervisor || status !== "open"}
          onChange={(e) => runner.setSupervisor({ defaultPolicy: e.target.value as Policy })}
        >
          {policyOptions.map((p) => (
            <option key={p} value={p}>
              {policyLabel[p]}
            </option>
          ))}
        </select>
      </label>
      <span className="text-xs text-muted">
        판단 엔진 <span className="text-foreground">{supervisor?.brain ?? "-"}</span>
        {supervisor?.brainModel ? <span className="font-mono"> · {supervisor.brainModel}</span> : null}
      </span>
      {usage && (
        <span className="text-xs text-muted sm:ml-auto">
          호출 {usage.brainCalls}
          {usage.brainErrors ? <span className="text-danger"> (오류 {usage.brainErrors})</span> : null} · 입력 {usage.inputTokens.toLocaleString()} · 출력 {usage.outputTokens.toLocaleString()} 토큰
        </span>
      )}
    </section>
  );
}

function SessionsSection({ runner }: { runner: RunnerApi }) {
  const { sessions, workspaces, status } = runner;
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(() => {
    const list = sessions.filter((s) => (filter === "running" ? s.status === "running" : filter === "attention" ? needsAttention(s) : true));
    const rank = (x: (typeof list)[number]) => (needsAttention(x) ? 0 : x.status === "running" ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  }, [sessions, filter]);
  const attentionCount = sessions.filter(needsAttention).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {(
          [
            ["all", `전체 ${sessions.length}`],
            ["running", `실행 중 ${sessions.filter((s) => s.status === "running").length}`],
            ["attention", `주의 ${attentionCount}`],
          ] as Array<[Filter, string]>
        ).map(([f, label]) => (
          <button key={f} className={`btn min-h-9 ${filter === f ? "border-accent text-foreground" : ""} ${f === "attention" && attentionCount ? "text-warn" : ""}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        <button
          className="btn ml-auto min-h-9"
          disabled={!sessions.some((s) => s.status !== "running")}
          onClick={() => runner.remove(sessions.filter((s) => s.status !== "running").map((s) => s.id))}
        >
          끝난 세션 정리
        </button>
      </div>
      {visible.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">{status === "open" ? "세션이 없습니다. 새 작업에서 시작하거나, PC에서 dclaude로 Claude Code를 켜면 여기 나타납니다." : "러너에 연결되면 세션이 표시됩니다."}</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visible.map((s) => (
            <SessionCard key={s.id} session={s} workspace={workspaces[s.id]} runner={runner} />
          ))}
        </div>
      )}
    </div>
  );
}
