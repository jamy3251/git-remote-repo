"use client";

import { useMemo, useState } from "react";
import type { WorkLogEntry } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { fmtDuration, shortPath } from "./labels";

interface Props {
  runner: RunnerApi;
  /** Pre-fill the new-task form with a past instruction. */
  onReuse?: (e: WorkLogEntry) => void;
  className?: string;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "오늘";
  if (same(d, y)) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function outcome(e: WorkLogEntry): { text: string; cls: string } {
  if (e.status === "killed") return { text: "중단", cls: "text-muted" };
  if (e.status === "error") return { text: "오류", cls: "text-danger" };
  if (e.exitCode === 0) return { text: "완료", cls: "text-ok" };
  if (e.exitCode === null) return { text: "종료", cls: "text-muted" };
  return { text: "실패", cls: "text-danger" };
}

/** Finished sessions grouped by day: what ran where, how it ended, what changed. */
export function WorkLogView({ runner, onReuse, className = "" }: Props) {
  const { worklog } = runner;
  const [folder, setFolder] = useState<string>("all");
  const folders = useMemo(() => [...new Set(worklog.map((e) => e.cwd))], [worklog]);
  const groups = useMemo(() => {
    const list = folder === "all" ? worklog : worklog.filter((e) => e.cwd === folder);
    const out: Array<{ day: string; items: WorkLogEntry[] }> = [];
    for (const e of list) {
      const day = dayLabel(e.endedAt);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [worklog, folder]);

  return (
    <section className={`card ${className}`}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-medium">작업 내역</h2>
        <span className="text-xs text-muted">{worklog.length}건</span>
        {folders.length > 1 && (
          <select className="input ml-auto min-h-9 w-auto max-w-[55%] text-xs" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="all">모든 폴더</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {shortPath(f, 40)}
              </option>
            ))}
          </select>
        )}
      </header>
      {groups.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted">끝난 세션이 여기에 쌓입니다. 무엇을 했고 결과가 어땠는지 나중에 폰에서 확인하세요.</p>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.day}>
              <div className="sticky top-0 z-[1] bg-surface/95 px-3 pb-1 pt-3 text-[11px] font-medium text-muted backdrop-blur">{g.day}</div>
              <ul className="divide-y divide-border/70">
                {g.items.map((e) => (
                  <Item key={e.id} entry={e} runner={runner} onReuse={onReuse} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Item({ entry: e, runner, onReuse }: { entry: WorkLogEntry; runner: RunnerApi; onReuse?: (e: WorkLogEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const o = outcome(e);

  async function summarize() {
    setBusy(true);
    setErr(null);
    try {
      await runner.summarizeWork(e.id);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-3 py-2.5">
      <button className="block w-full text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-baseline gap-2">
          <span className={`shrink-0 text-xs font-medium ${o.cls}`}>{o.text}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.name}</span>
          <span className="shrink-0 text-[11px] text-muted">
            {new Date(e.endedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} · {fmtDuration(e.startedAt, e.endedAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="truncate font-mono">{shortPath(e.cwd, 34)}</span>
          {e.git && (e.git.insertions > 0 || e.git.deletions > 0) && (
            <span className="shrink-0">
              <span className="text-ok">+{e.git.insertions}</span> <span className="text-danger">-{e.git.deletions}</span>
            </span>
          )}
        </div>
        <p className={`mt-1 text-[13px] leading-snug ${e.summarySource === "brain" ? "text-foreground" : "text-foreground/80"} ${open ? "" : "line-clamp-2"}`}>{e.summary}</p>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {(e.prompt || e.goal) && (
            <div className="rounded-md bg-background px-2.5 py-2 text-xs">
              <div className="mb-0.5 text-[11px] text-muted">{e.prompt ? "지시" : "목표"}</div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{e.prompt ?? e.goal}</div>
            </div>
          )}
          {e.tail.length > 0 && (
            <pre className="max-h-48 overflow-auto rounded-md bg-background px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">{e.tail.slice(-24).join("\n")}</pre>
          )}
          {e.git && e.git.files.length > 0 && (
            <div className="text-[11px] text-muted">
              변경 파일 {e.git.files.length}개 ({e.git.branch}): <span className="font-mono">{e.git.files.slice(0, 6).join(", ")}</span>
              {e.git.files.length > 6 ? " …" : ""}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {e.summarySource !== "brain" && (
              <button className="btn min-h-9 text-xs" onClick={summarize} disabled={busy || runner.status !== "open"}>
                {busy ? "요약하는 중…" : "AI로 요약"}
              </button>
            )}
            {onReuse && (e.prompt || e.goal) && (
              <button className="btn min-h-9 text-xs" onClick={() => onReuse(e)}>
                이 지시로 다시
              </button>
            )}
            <span className="ml-auto font-mono text-[10px] text-muted">{e.id}</span>
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
      )}
    </li>
  );
}
