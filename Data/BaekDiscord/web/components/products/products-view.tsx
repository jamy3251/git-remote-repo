"use client";

import { useEffect, useMemo, useState } from "react";
import type { Product, ProductHealth, ProductStage } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

export const stageLabel: Record<ProductStage, string> = {
  idea: "아이디어",
  building: "개발",
  testing: "검증",
  live: "배포",
  maintain: "유지",
  archived: "보관",
};
const STAGES = Object.keys(stageLabel) as ProductStage[];

const healthMeta: Record<ProductHealth, { label: string; dot: string; text: string; hint: string }> = {
  active: { label: "활발", dot: "bg-ok", text: "text-ok", hint: "최근 7일 안에 커밋·Claude 대화·작업이 있었습니다" },
  slowing: { label: "정체", dot: "bg-warn", text: "text-warn", hint: "마지막 활동이 7~30일 전입니다" },
  dormant: { label: "방치", dot: "bg-muted", text: "text-muted", hint: "30일 넘게 활동이 없습니다" },
};

/** Sequential steps of the accent hue over the dark surface: more activity = brighter. */
const HEAT = ["#29334c", "#3c4b76", "#5266a3", "#6781d1", "#7c9cff"];
const HEAT_BINS: Array<[number, string]> = [
  [1, "1"],
  [3, "2-3"],
  [6, "4-6"],
  [10, "7-10"],
  [Infinity, "11+"],
];

function heatColor(n: number): string | null {
  if (n <= 0) return null;
  const i = HEAT_BINS.findIndex(([max]) => n <= max);
  return HEAT[i];
}

function ago(t: number | null): string {
  if (!t) return "기록 없음";
  const d = (Date.now() - t) / 86_400_000;
  if (d < 1 / 24) return "방금";
  if (d < 1) return `${Math.round(d * 24)}시간 전`;
  if (d < 60) return `${Math.round(d)}일 전`;
  return `${Math.round(d / 30)}개월 전`;
}

function weekLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

type HealthFilter = "all" | "attention" | ProductHealth;

export interface ProductDraft {
  cwd: string;
  prompt: string;
  goal?: string;
}

interface Props {
  runner: RunnerApi;
  onDraft?: (d: ProductDraft) => void;
}

/** Portfolio of everything built under the runner root: what's alive, what's rotting, what to do next. */
export function ProductsView({ runner, onDraft }: Props) {
  const { products, status } = runner;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ProductStage | "none" | "all">("all");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; week: number; n: number } | null>(null);
  const [allRows, setAllRows] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      await runner.loadProducts(refresh);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const { loadProducts } = runner;
  const needLoad = status === "open" && !products;
  useEffect(() => {
    if (!needLoad) return;
    loadProducts().catch((e: Error) => setError(e.message));
  }, [needLoad, loadProducts]);

  const visible = useMemo(() => (products?.list ?? []).filter((p) => showHidden || !p.meta.hidden), [products, showHidden]);
  const counts = useMemo(
    () => ({
      total: visible.length,
      active: visible.filter((p) => p.health === "active").length,
      slowing: visible.filter((p) => p.health === "slowing").length,
      dormant: visible.filter((p) => p.health === "dormant").length,
      attention: visible.filter((p) => p.flags.length > 0).length,
    }),
    [visible],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visible
      .filter((p) => (stage === "all" ? true : stage === "none" ? !p.meta.stage : p.meta.stage === stage))
      .filter((p) => (health === "all" ? true : health === "attention" ? p.flags.length > 0 : p.health === health))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .sort((a, b) => Number(b.meta.pinned) - Number(a.meta.pinned) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.name.localeCompare(b.name));
  }, [visible, stage, health, query]);

  const weeks = products?.weeks ?? [];
  // The heatmap shows products with activity in the window; quiet ones fold away.
  const heatRows = useMemo(() => (allRows ? list : list.filter((p) => p.meta.pinned || p.activity.some((n) => n > 0))), [list, allRows]);
  const quiet = list.length - list.filter((p) => p.meta.pinned || p.activity.some((n) => n > 0)).length;

  if (!products) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        {status !== "open" ? "러너에 연결되면 프로덕트를 불러옵니다." : error ? <span className="text-danger">{error}</span> : "프로젝트 폴더를 훑는 중… (처음엔 몇 초 걸립니다)"}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Tile label="프로덕트" value={counts.total} onClick={() => setHealth("all")} active={health === "all"} />
        <Tile label="활발" value={counts.active} dot="bg-ok" onClick={() => setHealth("active")} active={health === "active"} />
        <Tile label="정체" value={counts.slowing} dot="bg-warn" onClick={() => setHealth("slowing")} active={health === "slowing"} />
        <Tile label="방치" value={counts.dormant} dot="bg-muted" onClick={() => setHealth("dormant")} active={health === "dormant"} />
        <Tile label="손볼 것" value={counts.attention} warn onClick={() => setHealth("attention")} active={health === "attention"} />
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-medium">최근 12주 활동</h2>
          <span className="text-[11px] text-muted">커밋 + Claude 대화 + 러너 작업</span>
          <button className="btn ml-auto min-h-9 px-2.5 text-xs" onClick={() => load(true)} disabled={loading || status !== "open"}>
            {loading ? "훑는 중…" : "다시 스캔"}
          </button>
        </div>
        <div className="overflow-x-auto px-3 py-2">
          <table className="w-full table-fixed border-separate" style={{ borderSpacing: "2px" }} aria-label="프로덕트별 주간 활동">
            <thead>
              <tr>
                <th className="w-[6.5rem] text-left text-[10px] font-normal text-muted sm:w-40" />
                {weeks.map((w, i) => (
                  <th key={w} className="overflow-visible whitespace-nowrap text-left text-[10px] font-normal text-muted">
                    {i % 4 === 0 ? weekLabel(w) : ""}
                  </th>
                ))}
                <th className="hidden w-20 pl-2 text-right text-[10px] font-normal text-muted sm:table-cell">마지막</th>
              </tr>
            </thead>
            <tbody>
              {heatRows.map((p) => (
                <tr key={p.path} className="cursor-pointer" onClick={() => setSelected(p.path === selected ? null : p.path)}>
                  <td className="truncate pr-1 text-xs" title={p.path}>
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${healthMeta[p.health].dot}`} />
                    <span className={selected === p.path ? "text-accent" : ""}>{p.name}</span>
                  </td>
                  {p.activity.map((n, i) => {
                    const c = heatColor(n);
                    return (
                      <td
                        key={i}
                        className="h-5 rounded-[3px] p-0"
                        style={{ background: c ?? "var(--surface-2)" }}
                        onMouseEnter={() => setHover({ name: p.name, week: weeks[i], n })}
                        onMouseLeave={() => setHover(null)}
                        title={`${p.name} · ${weekLabel(weeks[i])} 주 · 활동 ${n}`}
                      />
                    );
                  })}
                  <td className="hidden whitespace-nowrap pl-2 text-right text-[11px] text-muted sm:table-cell">{ago(p.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="py-6 text-center text-xs text-muted">조건에 맞는 프로덕트가 없습니다</p>}
          {quiet > 0 && (
            <button className="mt-1 w-full rounded-md py-1.5 text-center text-xs text-muted hover:text-foreground" onClick={() => setAllRows((v) => !v)}>
              {allRows ? "활동 있는 것만 보기" : `12주 동안 활동 없는 ${quiet}개 더 보기`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted">
          <span className="min-w-0 flex-1 truncate text-foreground/80">{hover ? `${hover.name} · ${weekLabel(hover.week)} 주 · 활동 ${hover.n}` : "칸에 올리면 주별 활동 수가 보입니다"}</span>
          <span>적음</span>
          <span className="inline-block h-3 w-3 rounded-[3px] bg-surface-2" title="0" />
          {HEAT.map((c, i) => (
            <span key={c} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: c }} title={HEAT_BINS[i][1]} />
          ))}
          <span>많음</span>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(["all", ...STAGES, "none"] as const).map((s) => {
            const n = s === "all" ? visible.length : s === "none" ? visible.filter((p) => !p.meta.stage).length : visible.filter((p) => p.meta.stage === s).length;
            return (
              <button key={s} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${stage === s ? "border-accent text-foreground" : "border-border text-muted hover:text-foreground"}`} onClick={() => setStage(s)}>
                {s === "all" ? "전체" : s === "none" ? "단계 미정" : stageLabel[s]} <span className="text-muted">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input className="input min-h-10 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·분류·설명으로 찾기" />
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            숨긴 것
          </label>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </section>

      <div className="grid gap-2 xl:grid-cols-2">
        {list.map((p) => (
          <ProductCard key={p.path} product={p} runner={runner} open={selected === p.path} onToggle={() => setSelected(selected === p.path ? null : p.path)} onDraft={onDraft} />
        ))}
      </div>
      <p className="pb-2 text-center text-[11px] text-muted">마지막 스캔 {ago(products.scannedAt)} · 활발 7일 이내 · 정체 30일 이내 · 방치 30일 초과</p>
    </div>
  );
}

function Tile({ label, value, dot, warn, onClick, active }: { label: string; value: number; dot?: string; warn?: boolean; onClick: () => void; active: boolean }) {
  return (
    <button className={`card px-3 py-2 text-left transition ${active ? "border-accent" : "hover:border-accent/60"}`} onClick={onClick}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${warn && value > 0 ? "text-warn" : ""}`}>{value}</div>
    </button>
  );
}

function ProductCard({ product: p, runner, open, onToggle, onDraft }: { product: Product; runner: RunnerApi; open: boolean; onToggle: () => void; onDraft?: (d: ProductDraft) => void }) {
  const h = healthMeta[p.health];
  const [busy, setBusy] = useState<"insight" | "ping" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function act(kind: "insight" | "ping") {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "insight") await runner.productInsight(p.path);
      else await runner.pingProduct(p.path);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function update(patch: Parameters<RunnerApi["updateProduct"]>[1]) {
    runner.updateProduct(p.path, patch).catch((e: Error) => setErr(e.message));
  }

  const ping = p.meta.ping;

  return (
    <article className={`card overflow-hidden ${open ? "border-accent/60" : ""} ${p.meta.hidden ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {p.meta.pinned && <span className="text-[10px] font-medium text-accent">고정</span>}
            <span className="font-medium">{p.name}</span>
            {p.category && <span className="text-[11px] text-muted">{p.category}</span>}
            <span className={`flex items-center gap-1 text-[11px] ${h.text}`} title={h.hint}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${h.dot}`} />
              {h.label}
            </span>
          </div>
          {p.description && <p className={`mt-0.5 text-[13px] leading-snug text-foreground/80 ${open ? "" : "line-clamp-1"}`}>{p.description}</p>}
        </button>
        <select className="input min-h-8 w-auto shrink-0 py-0.5 text-xs" value={p.meta.stage ?? ""} onChange={(e) => update({ stage: (e.target.value || null) as ProductStage | null })} aria-label="단계">
          <option value="">단계 미정</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 pt-1 text-[11px] text-muted">
        <span>활동 {ago(p.lastActiveAt)}</span>
        {p.git && (
          <span className="min-w-0 truncate">
            · <span className="font-mono">{p.git.branch}</span> {p.git.lastCommit && `· ${p.git.lastCommit}`}
          </span>
        )}
        {p.markers.filter((m) => m !== "git" && m !== "claude").map((m) => (
          <span key={m} className="rounded bg-border/60 px-1 leading-4">
            {m}
          </span>
        ))}
        {p.markers.includes("claude") && <span className="rounded bg-accent/15 px-1 leading-4 text-accent">Claude</span>}
      </div>

      {(p.flags.length > 0 || p.deployUrl) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
          {p.flags.map((f) => (
            <span key={f.kind} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${f.kind === "down" || f.kind === "failed" || f.kind === "review" ? "border-danger/40 text-danger" : "border-warn/40 text-warn"}`}>
              {f.text}
            </span>
          ))}
          {p.deployUrl && (
            <a className="truncate text-[11px] text-accent underline-offset-2 hover:underline" href={p.deployUrl} target="_blank" rel="noreferrer">
              {p.deployUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          {ping && (
            <span className={`text-[11px] ${ping.ok ? "text-ok" : "text-danger"}`}>
              {ping.ok ? `응답 ${ping.status} · ${ping.ms}ms` : "응답 없음"} · {ago(ping.at)}
            </span>
          )}
        </div>
      )}

      {p.meta.insight && (
        <div className="mx-3 mb-2 rounded-md bg-background px-2.5 py-2 text-xs">
          <div className="mb-0.5 flex items-center gap-2 text-[11px] text-muted">
            <span>AI 점검</span>
            <span>{ago(p.meta.insight.at)}</span>
          </div>
          <p className="text-[13px] leading-snug">{p.meta.insight.status}</p>
          {p.meta.insight.next.length > 0 && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              {p.meta.insight.next.map((n, i) => (
                <li key={i} className="leading-snug">
                  {n}
                  {onDraft && (
                    <button className="ml-1.5 text-[11px] text-accent underline-offset-2 hover:underline" onClick={() => onDraft({ cwd: p.path, prompt: n, goal: n })}>
                      작업으로
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
          {p.meta.insight.risks.length > 0 && <p className="mt-1 text-warn">{p.meta.insight.risks.join(" · ")}</p>}
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div className="font-mono text-[11px] text-muted">{p.path}</div>
          <label className="block">
            <span className="label">메모</span>
            <textarea
              className="input min-h-[60px] text-[13px]"
              value={note ?? p.meta.note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== null && note !== p.meta.note) update({ note });
                setNote(null);
              }}
              placeholder="마감, 다음에 할 일, 배포 계정 같은 것"
            />
          </label>
          <label className="block">
            <span className="label">배포 주소</span>
            <input
              className="input min-h-10 font-mono text-xs"
              value={url ?? p.meta.deployUrl ?? p.deployUrl ?? ""}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => {
                if (url !== null && url.trim() !== (p.meta.deployUrl ?? p.deployUrl ?? "")) update({ deployUrl: url.trim() || null });
                setUrl(null);
              }}
              placeholder="https://..."
            />
          </label>
          <div className="text-[11px] text-muted">
            {p.git ? `${p.git.ownRepo ? "자체 저장소" : "상위 저장소에 포함"} · 미커밋 ${p.git.dirty}${p.git.ahead ? ` · 미푸시 ${p.git.ahead}` : ""}` : "git 저장소 아님"} · Claude {ago(p.claudeAt)} · 러너 작업 {p.work.count}건
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
        <button className="btn min-h-9 text-xs" onClick={() => act("insight")} disabled={!!busy || runner.status !== "open"}>
          {busy === "insight" ? "점검 중…" : "AI 점검"}
        </button>
        {p.deployUrl && (
          <button className="btn min-h-9 text-xs" onClick={() => act("ping")} disabled={!!busy || runner.status !== "open"}>
            {busy === "ping" ? "확인 중…" : "배포 확인"}
          </button>
        )}
        {onDraft && (
          <button className="btn min-h-9 text-xs" onClick={() => onDraft({ cwd: p.path, prompt: "" })}>
            새 작업
          </button>
        )}
        <span className="ml-auto flex gap-1.5">
          <button className="btn min-h-9 px-2 text-xs" onClick={() => update({ pinned: !p.meta.pinned })}>
            {p.meta.pinned ? "고정 해제" : "고정"}
          </button>
          <button className="btn min-h-9 px-2 text-xs" onClick={() => update({ hidden: !p.meta.hidden })}>
            {p.meta.hidden ? "다시 보기" : "숨기기"}
          </button>
        </span>
      </div>
      {err && <p className="px-3 pb-2 text-xs text-danger">{err}</p>}
    </article>
  );
}
