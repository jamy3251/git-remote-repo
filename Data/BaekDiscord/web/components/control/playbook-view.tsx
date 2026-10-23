"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlaybookEntry, PlaybookInput } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

interface Props {
  runner: RunnerApi;
  /** A draft to review and save (from a work-log entry). */
  draft?: PlaybookInput | null;
  onDraftConsumed?: () => void;
  className?: string;
}

const EMPTY: PlaybookInput = { title: "", tags: [], symptom: "", cause: "", fix: "", example: "", related: [] };

export function PlaybookView({ runner, draft, onDraftConsumed, className = "" }: Props) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<PlaybookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; value: PlaybookInput } | null>(draft ? { value: draft } : null);
  const open = runner.status === "open";

  const search = useCallback(
    async (q: string) => {
      try {
        setEntries(await runner.searchPlaybook(q));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [runner],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(query), query ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  if (editing) {
    return (
      <Editor
        runner={runner}
        initial={editing.value}
        id={editing.id}
        className={className}
        onCancel={() => {
          setEditing(null);
          onDraftConsumed?.();
        }}
        onSaved={() => {
          setEditing(null);
          onDraftConsumed?.();
          void search(query);
        }}
      />
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex gap-2">
        <input className="input min-h-10 flex-1" placeholder="에러 문구나 증상으로 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-primary min-h-10 shrink-0 text-sm" onClick={() => setEditing({ value: EMPTY })} disabled={!open}>
          새 항목
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {!open && <p className="text-sm text-muted">러너에 연결되면 볼 수 있어요.</p>}
      {open && entries && entries.length === 0 && <p className="text-sm text-muted">{query ? "맞는 항목이 없어요. 풀고 나면 새 항목으로 남겨 두세요." : "아직 항목이 없어요."}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {entries?.map((e) => (
          <Item key={e.id} entry={e} onEdit={() => setEditing({ id: e.id, value: e })} />
        ))}
      </ul>
    </div>
  );
}

function Item({ entry: e, onEdit }: { entry: PlaybookEntry; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3 py-2.5">
      <button className="block w-full text-left" onClick={() => setOpen((v) => !v)}>
        <div className="text-sm font-medium">{e.title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-muted">{e.symptom}</div>
        {e.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {e.tags.map((t) => (
              <span key={t} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                {t}
              </span>
            ))}
          </div>
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          {e.cause && <Block label="원인" text={e.cause} />}
          <Block label="해결" text={e.fix} />
          {e.example && <Block label="예시" text={e.example} mono />}
          {e.related.length > 0 && <Block label="관련" text={e.related.join("\n")} />}
          <div className="flex items-center gap-2">
            <button className="btn min-h-9 text-xs" onClick={onEdit}>
              고치기
            </button>
            <span className="ml-auto font-mono text-[10px] text-muted">{e.id}</span>
          </div>
        </div>
      )}
    </li>
  );
}

function Block({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <p className={`whitespace-pre-wrap break-words ${mono ? "font-mono text-xs" : ""}`}>{text}</p>
    </div>
  );
}

type Form = Omit<PlaybookInput, "tags" | "related"> & { tags: string; related: string };

function Editor({ runner, initial, id, className, onCancel, onSaved }: { runner: RunnerApi; initial: PlaybookInput; id?: string; className: string; onCancel: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Form>({ ...initial, tags: initial.tags.join(", "), related: initial.related.join("\n") });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [similar, setSimilar] = useState<PlaybookEntry[]>([]);
  // Warn before saving what is probably already in the dictionary.
  useEffect(() => {
    const q = `${v.title} ${v.symptom}`.trim();
    if (id || q.length < 4) return;
    const t = setTimeout(() => {
      runner
        .searchPlaybook(v.title.trim() || q)
        .then((r) => setSimilar(r.slice(0, 3)))
        .catch(() => setSimilar([]));
    }, 400);
    return () => clearTimeout(t);
  }, [v.title, v.symptom, id, runner]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await runner.savePlaybook(
        {
          ...v,
          tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
          related: v.related.split("\n").map((t) => t.trim()).filter(Boolean),
        },
        id,
      );
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }

  const field = (label: string, k: keyof Form, rows: number) => (
    <label className="block">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <textarea className="input mt-0.5 w-full resize-y text-sm" rows={rows} value={v[k]} onChange={set(k)} />
    </label>
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <label className="block">
        <span className="text-[11px] font-medium text-muted">제목</span>
        <input className="input mt-0.5 min-h-10 w-full" value={v.title} onChange={set("title")} />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-muted">태그 (쉼표로 구분)</span>
        <input className="input mt-0.5 min-h-10 w-full" value={v.tags} onChange={set("tags")} />
      </label>
      {field("증상 (에러 문구처럼 검색에 걸릴 말)", "symptom", 3)}
      {field("원인 (모르면 비워 두세요)", "cause", 2)}
      {field("해결", "fix", 4)}
      {field("예시", "example", 3)}
      {field("관련 (한 줄에 하나)", "related", 2)}
      {similar.length > 0 && (
        <p className="rounded border border-border px-2 py-1.5 text-xs text-muted">
          비슷한 항목이 있어요: {similar.map((s) => s.title).join(" / ")}. 같은 문제면 그 항목을 고치는 쪽이 나아요.
        </p>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary min-h-10 flex-1" onClick={save} disabled={busy}>
          {busy ? "저장하는 중…" : "저장"}
        </button>
        <button className="btn min-h-10" onClick={onCancel} disabled={busy}>
          취소
        </button>
      </div>
    </div>
  );
}
