"use client";

import { useMemo, useState } from "react";
import type { CrossReview, ReviewMode, ReviewerId, WorkLogEntry } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";
import { fmtDuration, shortPath } from "./labels";

/** A new task to pre-fill (past instruction, or a fix for review findings). */
export interface DraftRequest {
  cwd: string;
  prompt: string;
  goal?: string;
  preset?: string;
}

interface Props {
  runner: RunnerApi;
  onDraft?: (d: DraftRequest) => void;
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
export function WorkLogView({ runner, onDraft, className = "" }: Props) {
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
                  <Item key={e.id} entry={e} runner={runner} onDraft={onDraft} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Item({ entry: e, runner, onDraft }: { entry: WorkLogEntry; runner: RunnerApi; onDraft?: (d: DraftRequest) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState<ReviewerId | "auto">("auto");
  const [mode, setMode] = useState<ReviewMode>("review");
  const [starting, setStarting] = useState(false);
  const o = outcome(e);
  const last = e.reviews?.[e.reviews.length - 1];
  const reviewing = last?.status === "running";

  async function review() {
    setStarting(true);
    setErr(null);
    try {
      await runner.crossReview(e.id, reviewer, mode);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setStarting(false);
    }
  }

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
        {last && !open && <ReviewLine review={last} />}
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
          {e.reviews?.map((r) => (
            <ReviewCard key={r.sessionId} review={r} onFix={r.fixPrompt && onDraft ? () => onDraft({ cwd: e.cwd, prompt: r.fixPrompt!, goal: `교차검증 지적 해결: ${e.name}`, preset: e.preset }) : undefined} />
          ))}
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="mb-1.5 text-[11px] text-muted">교차검증: 다른 AI가 읽기 전용으로 이 작업을 검토합니다</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select className="input min-h-9 w-auto text-xs" value={reviewer} onChange={(x) => setReviewer(x.target.value as ReviewerId | "auto")} disabled={reviewing}>
                <option value="auto">자동 (작업한 AI의 반대)</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
              <select className="input min-h-9 w-auto text-xs" value={mode} onChange={(x) => setMode(x.target.value as ReviewMode)} disabled={reviewing}>
                <option value="review">리뷰</option>
                <option value="challenge">깨뜨려 보기</option>
              </select>
              <button className="btn btn-primary min-h-9 text-xs" onClick={review} disabled={reviewing || starting || runner.status !== "open"}>
                {reviewing ? "검증 중…" : starting ? "시작하는 중…" : "교차검증"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {e.summarySource !== "brain" && (
              <button className="btn min-h-9 text-xs" onClick={summarize} disabled={busy || runner.status !== "open"}>
                {busy ? "요약하는 중…" : "AI로 요약"}
              </button>
            )}
            {onDraft && (e.prompt || e.goal) && (
              <button className="btn min-h-9 text-xs" onClick={() => onDraft({ cwd: e.cwd, prompt: e.prompt ?? e.goal ?? "", goal: e.goal ?? undefined, preset: e.preset })}>
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

const reviewerName: Record<ReviewerId, string> = { codex: "Codex", claude: "Claude" };

function verdictMeta(r: CrossReview): { text: string; cls: string } {
  if (r.status === "running") return { text: "검증 중", cls: "text-accent" };
  if (r.status === "failed") return { text: "결과 없음", cls: "text-muted" };
  if (r.verdict === "pass") return { text: "통과", cls: "text-ok" };
  if (r.verdict === "fail") return { text: "수정 필요", cls: "text-danger" };
  return { text: "판단 보류", cls: "text-warn" };
}

/** One-line review status for the collapsed list row. */
function ReviewLine({ review: r }: { review: CrossReview }) {
  const v = verdictMeta(r);
  const p1 = r.findings.filter((f) => f.severity === "P1").length;
  return (
    <span className="mt-1 flex items-center gap-1.5 text-[11px]">
      <span className="text-muted">{reviewerName[r.reviewer]} 검증</span>
      <span className={v.cls}>{v.text}</span>
      {r.findings.length > 0 && (
        <span className="text-muted">
          · 지적 {r.findings.length}
          {p1 ? <span className="text-danger"> (P1 {p1})</span> : null}
        </span>
      )}
    </span>
  );
}

const sevCls: Record<string, string> = { P1: "bg-danger/15 text-danger", P2: "bg-warn/15 text-warn", P3: "bg-border/60 text-muted" };

function ReviewCard({ review: r, onFix }: { review: CrossReview; onFix?: () => void }) {
  const v = verdictMeta(r);
  return (
    <div className={`rounded-md border px-2.5 py-2 ${r.verdict === "fail" ? "border-danger/40" : r.verdict === "pass" ? "border-ok/30" : "border-border"}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{reviewerName[r.reviewer]}</span>
        <span className="text-muted">{r.mode === "challenge" ? "깨뜨려 보기" : "리뷰"}</span>
        <span className={`font-medium ${v.cls}`}>{v.text}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">{r.sessionId}</span>
      </div>
      {r.summary && <p className="mt-1 text-[13px] leading-snug">{r.summary}</p>}
      {r.findings.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {r.findings.map((f, i) => (
            <li key={i} className="text-xs leading-snug">
              <span className={`mr-1.5 rounded px-1 font-mono text-[10px] ${sevCls[f.severity]}`}>{f.severity}</span>
              {f.file && (
                <span className="font-mono text-[11px] text-muted">
                  {f.file}
                  {f.line ? `:${f.line}` : ""}{" "}
                </span>
              )}
              <span>{f.issue}</span>
              {f.fix && <div className="mt-0.5 pl-7 text-muted">{f.fix}</div>}
            </li>
          ))}
        </ul>
      )}
      {onFix && (
        <button className="btn btn-primary mt-2 min-h-9 text-xs" onClick={onFix}>
          원래 AI에게 고치게 하기
        </button>
      )}
    </div>
  );
}
