"use client";

import { useCallback, useMemo, useState } from "react";
import type { FsListing } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

const RECENT_KEY = "devhub.recentFolders";
const RECENT_MAX = 8;

const markerLabel: Record<string, string> = {
  git: "git",
  claude: "Claude",
  node: "Node",
  python: "Python",
  flutter: "Flutter",
  unity: "Unity",
  rust: "Rust",
  go: "Go",
  java: "Java",
};

export function loadRecentFolders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberFolder(path: string): void {
  try {
    const next = [path, ...loadRecentFolders().filter((p) => p !== path)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

function tail(p: string, n = 2): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= n ? p : `…\\${parts.slice(-n).join("\\")}`;
}

function isFresh(ms: number): boolean {
  return Date.now() - ms < 30 * 60_000;
}

function ago(ms: number): string {
  const d = (Date.now() - ms) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))}분 전`;
  if (d < 86400) return `${Math.round(d / 3600)}시간 전`;
  if (d < 86400 * 60) return `${Math.round(d / 86400)}일 전`;
  return new Date(ms).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
}

interface Props {
  runner: RunnerApi;
  value: string;
  onChange: (path: string) => void;
}

/** Folder picker: shows the chosen folder, and on demand a browsable tree of the runner root. */
export function FolderPicker({ runner, value, onChange }: Props) {
  const root = runner.info?.cwdRoot ?? "";
  const shown = value || root;
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"name" | "recent" | "activity">("name");
  const [recent, setRecent] = useState<string[]>([]);
  const [manual, setManual] = useState(false);

  const go = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        setListing(await runner.listFolder(path));
        setFilter("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [runner],
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setRecent(loadRecentFolders());
      void go(value || undefined);
    }
  }

  function pick(path: string) {
    onChange(path);
    setOpen(false);
  }

  const entries = useMemo(() => {
    if (!listing) return [];
    const q = filter.trim().toLowerCase();
    const list = q ? listing.entries.filter((e) => e.name.toLowerCase().includes(q)) : listing.entries;
    if (sort === "recent") return [...list].sort((a, b) => b.modifiedAt - a.modifiedAt);
    if (sort === "activity") return [...list].sort((a, b) => b.running - a.running || (b.claudeAt ?? 0) - (a.claudeAt ?? 0));
    return list;
  }, [listing, filter, sort]);

  const live = listing?.live ?? [];
  const quick = recent.filter((p) => !live.some((l) => l.path.toLowerCase() === p.toLowerCase()));

  return (
    <div className="min-w-0">
      <span className="label">폴더</span>
      <div className="flex gap-2">
        {manual ? (
          <input className="input min-h-11 font-mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={root || "러너 루트"} autoFocus />
        ) : (
          <button type="button" className="input flex min-h-11 min-w-0 items-center text-left font-mono" onClick={toggle} title={shown}>
            <span className="truncate">{shown ? tail(shown, 3) : "러너 연결 대기…"}</span>
          </button>
        )}
        <button type="button" className={`btn min-h-11 shrink-0 px-3 ${open ? "border-accent text-foreground" : ""}`} onClick={toggle} disabled={runner.status !== "open"}>
          {open ? "닫기" : "찾기"}
        </button>
      </div>

      {open && (
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-background">
          {live.length > 0 && (
            <div className="border-b border-border">
              <div className="px-3 pt-2 text-[11px] text-muted">지금 CLI가 켜진 폴더</div>
              <ul>
                {live.map((l) => (
                  <li key={l.path} className="flex items-stretch">
                    <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-surface" onClick={() => pick(l.path)} title={l.path}>
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${l.running ? "bg-ok" : "bg-accent"} ${l.running ? "animate-pulse" : ""}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{tail(l.path, 3)}</span>
                      <Activity running={l.running} claudeAt={l.claudeAt} />
                    </button>
                    <button type="button" className="shrink-0 px-3 text-xs text-muted hover:bg-surface hover:text-foreground" onClick={() => void go(l.path)}>
                      열기
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quick.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-border px-2 py-2">
              {quick.map((p) => (
                <button key={p} type="button" className="btn min-h-9 shrink-0 px-2 font-mono text-xs" onClick={() => pick(p)} title={p}>
                  {tail(p)}
                </button>
              ))}
            </div>
          )}

          {listing && (
            <nav className="flex items-center gap-0.5 overflow-x-auto px-2 pt-2 text-xs" aria-label="경로">
              {listing.crumbs.map((c, i) => (
                <span key={c.path} className="flex shrink-0 items-center">
                  {i > 0 && <span className="px-0.5 text-muted">/</span>}
                  <button
                    type="button"
                    className={`rounded px-1.5 py-1 font-mono ${i === listing.crumbs.length - 1 ? "text-foreground" : "text-muted hover:text-foreground"}`}
                    onClick={() => void go(c.path)}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2 px-2 py-2">
            <input className="input min-h-9 flex-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이 안에서 찾기" />
            <button type="button" className="btn min-h-9 shrink-0 px-2 text-xs" onClick={() => setSort((s) => (s === "name" ? "recent" : s === "recent" ? "activity" : "name"))}>
              {sort === "name" ? "이름순" : sort === "recent" ? "최근 수정순" : "CLI 활동순"}
            </button>
          </div>

          {listing && (
            <div className="flex items-center gap-2 border-y border-border bg-surface px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs" title={listing.path}>
                  {tail(listing.path, 3)}
                </div>
                {listing.markers.length > 0 && <Markers markers={listing.markers} />}
              </div>
              <button type="button" className="btn btn-primary min-h-10 shrink-0 px-3" onClick={() => pick(listing.path)}>
                이 폴더로
              </button>
            </div>
          )}

          <ul className="max-h-[50vh] overflow-y-auto">
            {listing?.parent && (
              <li>
                <button type="button" className="flex min-h-11 w-full items-center px-3 text-left text-sm text-muted hover:bg-surface" onClick={() => void go(listing.parent!)}>
                  ..&nbsp;상위 폴더
                </button>
              </li>
            )}
            {entries.map((e) => (
              <li key={e.path} className="flex items-stretch border-t border-border/60">
                <button type="button" className="flex min-h-12 min-w-0 flex-1 flex-col justify-center px-3 py-1.5 text-left hover:bg-surface" onClick={() => void go(e.path)}>
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate text-sm">{e.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted">수정 {ago(e.modifiedAt)}</span>
                  </span>
                  {(e.running > 0 || e.claudeAt !== null) && (
                    <span className="mt-0.5 flex w-full justify-end">
                      <Activity running={e.running} claudeAt={e.claudeAt} />
                    </span>
                  )}
                  {e.markers.length > 0 && <Markers markers={e.markers} />}
                </button>
                <button type="button" className="shrink-0 border-l border-border/60 px-3 text-xs text-muted hover:bg-surface hover:text-foreground" onClick={() => pick(e.path)} aria-label={`${e.name} 선택`}>
                  선택
                </button>
              </li>
            ))}
            {listing && entries.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">{filter ? "일치하는 폴더가 없습니다" : "하위 폴더가 없습니다"}</li>}
            {listing?.truncated && <li className="px-3 py-2 text-center text-xs text-muted">폴더가 많아 일부만 표시합니다. 위 검색을 쓰세요.</li>}
          </ul>

          {(loading || error) && (
            <div className={`flex items-center gap-2 px-3 py-2 text-xs ${error ? "text-danger" : "text-muted"}`}>
              <span className="min-w-0 flex-1">{error ?? "불러오는 중…"}</span>
              {error && (
                <button type="button" className="btn min-h-9 px-2 text-xs" onClick={() => void go(listing?.path ?? (value || undefined))}>
                  다시 시도
                </button>
              )}
            </div>
          )}

          <div className="border-t border-border px-3 py-2 text-right">
            <button type="button" className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => setManual((m) => !m)}>
              {manual ? "탐색기로 고르기" : "경로 직접 입력"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Runner sessions running here (or below) and the last Claude Code activity. */
function Activity({ running, claudeAt }: { running: number; claudeAt: number | null }) {
  const fresh = claudeAt !== null && isFresh(claudeAt);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
      {running > 0 && <span className="rounded bg-ok/15 px-1 leading-4 text-ok">실행 중 {running}</span>}
      {claudeAt !== null && <span className={fresh ? "text-accent" : "text-muted"}>Claude {ago(claudeAt)}</span>}
    </span>
  );
}

function Markers({ markers }: { markers: string[] }) {
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {markers.map((m) => (
        <span key={m} className={`rounded px-1 text-[10px] leading-4 ${m === "claude" ? "bg-accent/15 text-accent" : m === "git" ? "bg-ok/10 text-ok" : "bg-border/60 text-muted"}`}>
          {markerLabel[m] ?? m}
        </span>
      ))}
    </span>
  );
}
