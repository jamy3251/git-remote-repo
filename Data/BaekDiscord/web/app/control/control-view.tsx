"use client";

import { useMemo, useState } from "react";
import type { Policy } from "@/lib/runner/protocol";
import { useRunner } from "@/lib/runner/use-runner";
import { RunnerSettingsBar } from "@/components/runner-settings-bar";
import { Overview } from "@/components/control/overview";
import { RemotePanel } from "@/components/control/remote-panel";
import { NewTaskForm } from "@/components/control/new-task-form";
import { SessionCard } from "@/components/control/session-card";
import { ChatPanel } from "@/components/control/chat-panel";
import { EventLog } from "@/components/control/event-log";
import { needsAttention, policyLabel, policyOptions } from "@/components/control/labels";

type Filter = "all" | "running" | "attention";

export function ControlView() {
  const runner = useRunner();
  const { sessions, supervisor, workspaces, status } = runner;
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const list = sessions.filter((s) => (filter === "running" ? s.status === "running" : filter === "attention" ? needsAttention(s) : true));
    const rank = (x: (typeof list)[number]) => (needsAttention(x) ? 0 : x.status === "running" ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  }, [sessions, filter]);

  const attentionCount = sessions.filter(needsAttention).length;
  const usage = supervisor?.usage;

  return (
    <div className="space-y-3 pb-24 lg:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">관제</h1>
          <p className="text-sm text-muted">에이전트 세션을 한눈에 보고, 슈퍼바이저가 판단하고, 어디서든 지시합니다.</p>
        </div>
      </div>

      <RunnerSettingsBar settings={runner.settings} status={status} onSave={runner.updateSettings} onConnect={runner.connect} error={runner.lastError} />

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
          <span className="ml-auto text-xs text-muted">
            호출 {usage.brainCalls}
            {usage.brainErrors ? <span className="text-danger"> (오류 {usage.brainErrors})</span> : null} · 입력 {usage.inputTokens.toLocaleString()} · 출력{" "}
            {usage.outputTokens.toLocaleString()} 토큰
          </span>
        )}
      </section>

      <Overview sessions={sessions} workspaces={workspaces} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <NewTaskForm runner={runner} />
          <RemotePanel tunnel={runner.tunnel} runner={runner} />

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
              종료된 세션 정리
            </button>
          </div>

          {visible.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted">
              {status === "open" ? "세션이 없습니다. 위 새 작업에서 시작하세요." : "러너에 연결되면 세션이 표시됩니다."}
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {visible.map((s) => (
                <SessionCard key={s.id} session={s} workspace={workspaces[s.id]} runner={runner} />
              ))}
            </div>
          )}

          <EventLog events={runner.events} sessions={sessions} />
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <ChatPanel runner={runner} className="lg:max-h-[calc(100vh-6rem)]" />
        </div>
      </div>
    </div>
  );
}
