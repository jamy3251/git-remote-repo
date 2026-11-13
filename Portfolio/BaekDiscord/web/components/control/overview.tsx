"use client";

import { useMemo } from "react";
import type { SessionInfo, WorkspaceInfo } from "@/lib/runner/protocol";
import { Sparkline } from "./sparkline";
import { fmtBytes } from "./labels";

interface Props {
  sessions: SessionInfo[];
  workspaces: Record<string, WorkspaceInfo>;
}

export function Overview({ sessions, workspaces }: Props) {
  const counts = useMemo(() => {
    const running = sessions.filter((s) => s.status === "running").length;
    const waiting = sessions.filter((s) => s.state === "waiting_input").length;
    const error = sessions.filter((s) => s.state === "error").length;
    const done = sessions.filter((s) => s.state === "done").length;
    return { running, waiting, error, done };
  }, [sessions]);

  const global = useMemo(() => {
    const sum = new Array<number>(60).fill(0);
    let loaded = 0;
    for (const w of Object.values(workspaces)) {
      if (!w.activity?.length) continue;
      loaded += 1;
      const offset = 60 - w.activity.length;
      w.activity.forEach((v, i) => {
        const idx = offset + i;
        if (idx >= 0 && idx < 60) sum[idx] += v;
      });
    }
    return { sum, loaded, total: sum.reduce((a, b) => a + b, 0) };
  }, [workspaces]);

  const tiles = [
    { label: "실행 중", value: counts.running, cls: "text-accent" },
    { label: "입력 대기", value: counts.waiting, cls: counts.waiting ? "text-warn" : "text-foreground" },
    { label: "오류", value: counts.error, cls: counts.error ? "text-danger" : "text-foreground" },
    { label: "완료", value: counts.done, cls: "text-ok" },
  ];

  return (
    <section className="grid gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
      {tiles.map((t) => (
        <div key={t.label} className="card px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">{t.label}</div>
          <div className={`text-2xl font-semibold leading-tight ${t.cls}`}>{t.value}</div>
        </div>
      ))}
      <div className="card px-3 py-2 sm:col-span-1">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted">
          <span>전체 활동 · 최근 30분</span>
          <span className="normal-case">
            {global.loaded ? `${global.loaded}개 세션 · ${fmtBytes(global.total)}` : "작업 현황을 열면 집계됩니다"}
          </span>
        </div>
        <Sparkline values={global.sum} height={32} title="전체 출력 활동" />
      </div>
    </section>
  );
}
