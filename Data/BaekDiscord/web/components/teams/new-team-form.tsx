"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showCommitTitles, setShowCommitTitles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, webhookUrl, showCommitTitles }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; teamId?: string };
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? `실패 (${res.status})`);
      return;
    }
    router.push(`/teams/${json.teamId}/settings`);
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="name">
          팀 이름
        </label>
        <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="캡스톤팀" />
      </div>
      <div>
        <label className="label" htmlFor="webhook">
          디스코드 웹훅 URL
        </label>
        <input
          id="webhook"
          className="input font-mono text-xs"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          required
          placeholder="https://discord.com/api/webhooks/…"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showCommitTitles} onChange={(e) => setShowCommitTitles(e.target.checked)} />
        커밋 제목을 다이제스트에 노출 (비공개 리포라면 끄는 것을 권장)
      </label>
      {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "테스트 메시지 전송 중…" : "테스트 메시지 보내고 팀 만들기"}
      </button>
    </form>
  );
}
