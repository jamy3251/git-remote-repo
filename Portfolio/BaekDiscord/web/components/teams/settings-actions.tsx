"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsActions({ teamId, defaultDate }: { teamId: string; defaultDate: string }) {
  const router = useRouter();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createInvite() {
    setBusy(true);
    const res = await fetch(`/api/teams/${teamId}/invite`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? "초대 링크 생성 실패");
    setInviteUrl(json.url ?? null);
  }

  async function trigger() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/cron/digest?team=${teamId}&date=${date}`, { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { results?: { status: string; error?: string }[]; error?: string };
    setBusy(false);
    if (!res.ok) return setMsg(json.error ?? `실패 (${res.status})`);
    const r = json.results?.[0];
    setMsg(r ? `${date}: ${r.status}${r.error ? ` — ${r.error}` : ""}` : "완료");
    router.refresh();
  }

  return (
    <section className="card space-y-4 p-5">
      <h2 className="font-medium">팀장 작업</h2>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={createInvite} disabled={busy}>
          초대 링크 만들기 (7일)
        </button>
        {inviteUrl && (
          <>
            <input className="input max-w-md font-mono text-xs" readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
              복사
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" className="input max-w-[180px]" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn" onClick={trigger} disabled={busy}>
          이 날짜 다이제스트 수동 생성·발행
        </button>
      </div>
      {msg && <p className="text-sm text-muted">{msg}</p>}
    </section>
  );
}
