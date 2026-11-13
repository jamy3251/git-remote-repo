"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RowEvent {
  id: string;
  type: string;
  repo: string;
  title?: string;
  prNumber?: number;
  included: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  commit: "커밋",
  pr_opened: "PR 열림",
  pr_merged: "PR 머지",
  pr_closed: "PR 닫힘",
};

export function RowEditor(props: {
  digestId: string;
  handle: string;
  isSelf: boolean;
  editable: boolean;
  showCommitTitles: boolean;
  optedOut: boolean;
  blockedNote: string;
  events: RowEvent[];
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<string>>(new Set(props.events.filter((e) => !e.included).map((e) => e.id)));
  const [note, setNote] = useState(props.blockedNote);
  const [optedOut, setOptedOut] = useState(props.optedOut);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    const res = await fetch(`/api/digests/${props.digestId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ excludedEventIds: [...excluded], blockedNote: note || null, optedOut }),
    });
    setBusy(false);
    if (res.status === 409) return setStatus("편집 창이 닫혔습니다 (60분 경과).");
    if (res.status === 403) return setStatus("본인 행만 편집할 수 있습니다.");
    if (!res.ok) return setStatus(`저장 실패 (${res.status})`);
    setStatus("저장됨 — 디스코드 메시지가 갱신되었습니다.");
    router.refresh();
  }

  const label = (e: RowEvent) => {
    const repo = e.repo.includes("/") ? e.repo.slice(e.repo.indexOf("/") + 1) : e.repo;
    const head = `${repo} · ${TYPE_LABEL[e.type] ?? e.type}${e.prNumber ? ` #${e.prNumber}` : ""}`;
    return props.showCommitTitles || e.type !== "commit" ? `${head}${e.title ? ` — ${e.title}` : ""}` : head;
  };

  return (
    <section className={`card p-4 ${props.isSelf ? "border-accent/60" : ""}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{props.handle}</span>
        {props.isSelf && <span className="badge">나</span>}
        {!props.editable && props.isSelf && <span className="badge">읽기 전용</span>}
      </div>
      {optedOut ? (
        <p className="text-sm text-muted">(발행 안 함)</p>
      ) : props.events.length === 0 ? (
        <p className="text-sm text-muted">(기록 없음)</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {props.events.map((e) => {
            const off = excluded.has(e.id);
            return (
              <li key={e.id} className={`flex items-center gap-2 ${off ? "text-muted line-through" : ""}`}>
                {props.editable ? (
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={(ev) => {
                      const next = new Set(excluded);
                      if (ev.target.checked) next.delete(e.id);
                      else next.add(e.id);
                      setExcluded(next);
                    }}
                  />
                ) : (
                  <span className="w-3 text-center text-xs">{off ? "×" : "•"}</span>
                )}
                <span>{label(e)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {(note || props.editable) && !optedOut && (
        <div className="mt-3">
          {props.editable ? (
            <input className="input" placeholder="⛔ 막힘 메모 (예: 카카오 로그인 키 승인 대기)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          ) : (
            note && <p className="text-sm">⛔ 막힘: {note}</p>
          )}
        </div>
      )}
      {props.editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={optedOut} onChange={(e) => setOptedOut(e.target.checked)} />
            이번엔 발행 안 함
          </label>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? "저장 중…" : "저장 (디스코드 갱신)"}
          </button>
          {status && <span className="text-xs text-muted">{status}</span>}
        </div>
      )}
    </section>
  );
}
