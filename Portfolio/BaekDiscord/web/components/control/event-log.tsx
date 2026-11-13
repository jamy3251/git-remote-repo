"use client";

import { useMemo, useState } from "react";
import type { SessionInfo, SupervisorEvent } from "@/lib/runner/protocol";
import { actorLabel, fmtTime, levelCls } from "./labels";

interface Props {
  events: SupervisorEvent[];
  sessions: SessionInfo[];
}

type LevelFilter = "all" | SupervisorEvent["level"];

export function EventLog({ events, sessions }: Props) {
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [open, setOpen] = useState(true);
  const names = useMemo(() => new Map(sessions.map((s) => [s.id, s.name])), [sessions]);
  const rows = useMemo(() => {
    const list = filter === "all" ? events : events.filter((e) => e.level === filter);
    return list.slice(-300).reverse();
  }, [events, filter]);

  return (
    <section className="card">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button className="font-medium" onClick={() => setOpen((v) => !v)}>
          이벤트 로그 <span className="text-xs text-muted">{rows.length}</span>
        </button>
        <div className="ml-auto flex gap-1">
          {(["all", "warn", "action", "error"] as LevelFilter[]).map((f) => (
            <button
              key={f}
              className={`btn px-2 py-0.5 text-[11px] ${filter === f ? "border-accent text-foreground" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "전체" : f === "warn" ? "주의" : f === "action" ? "행동" : "오류"}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <ul className="max-h-[360px] divide-y divide-border overflow-y-auto border-t border-border text-xs">
          {rows.length === 0 && <li className="px-3 py-3 text-muted">기록 없음</li>}
          {rows.map((e) => (
            <li key={e.id} className="flex gap-2 px-3 py-1.5">
              <span className="shrink-0 font-mono text-muted">{fmtTime(e.ts)}</span>
              <span className="badge shrink-0">{actorLabel[e.actor]}</span>
              {e.sessionId && <span className="shrink-0 truncate text-muted max-w-[90px]">{names.get(e.sessionId) ?? e.sessionId}</span>}
              <span className={`min-w-0 break-words ${levelCls[e.level]}`}>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
