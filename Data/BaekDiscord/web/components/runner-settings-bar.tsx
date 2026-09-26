"use client";

import { useState } from "react";
import type { ConnectionStatus } from "@/lib/runner/use-runner";
import type { RunnerSettings } from "@/lib/runner/settings";

interface Props {
  settings: RunnerSettings;
  status: ConnectionStatus | "http";
  statusText?: string;
  onSave: (s: RunnerSettings) => void;
  onConnect: () => void;
  error?: string | null;
}

const statusLabel: Record<Props["status"], { text: string; cls: string }> = {
  idle: { text: "미연결", cls: "text-muted" },
  connecting: { text: "연결 중…", cls: "text-warn" },
  open: { text: "연결됨", cls: "text-ok" },
  unauthorized: { text: "토큰 오류", cls: "text-danger" },
  closed: { text: "끊김", cls: "text-danger" },
  http: { text: "HTTP", cls: "text-muted" },
};

export function RunnerSettingsBar({ settings, status, statusText, onSave, onConnect, error }: Props) {
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState(settings.token);
  const [open, setOpen] = useState(!settings.token);
  const s = statusLabel[status];

  return (
    <div className="card mb-4 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">로컬 러너</span>
        <span className={s.cls}>● {statusText ?? s.text}</span>
        <span className="text-muted">{settings.url}</span>
        <button className="btn ml-auto" onClick={() => setOpen((v) => !v)}>
          {open ? "설정 닫기" : "설정"}
        </button>
        <button className="btn btn-primary" onClick={onConnect}>
          다시 연결
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {open && (
        <form
          className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ url: url.trim().replace(/\/$/, ""), token: token.trim() });
            setOpen(false);
            onConnect();
          }}
        >
          <label>
            <span className="label">러너 URL</span>
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:7331" />
          </label>
          <label>
            <span className="label">토큰 (runner/.runner-token 또는 RUNNER_TOKEN)</span>
            <input className="input font-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="러너 시작 로그에 출력된 토큰" />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary" type="submit">
              저장 후 연결
            </button>
          </div>
          <p className="text-xs text-muted md:col-span-3">
            러너 실행: <code className="font-mono">npm run dev:runner</code> (저장소 루트). 러너는 127.0.0.1에만 바인딩되고 이 페이지(localhost:3000)의 요청만 허용합니다.
          </p>
        </form>
      )}
    </div>
  );
}
