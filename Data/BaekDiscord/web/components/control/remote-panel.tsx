"use client";

import { useState } from "react";
import type { TunnelStatus } from "@/lib/runner/protocol";
import type { RunnerApi } from "@/lib/runner/use-runner";

interface Props {
  tunnel: TunnelStatus | null;
  runner: RunnerApi;
}

const stateLabel: Record<TunnelStatus["state"], { text: string; cls: string }> = {
  stopped: { text: "꺼짐", cls: "text-muted" },
  starting: { text: "여는 중…", cls: "text-warn" },
  running: { text: "열림", cls: "text-ok" },
  error: { text: "오류", cls: "text-danger" },
};

export function RemotePanel({ tunnel, runner }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = tunnel;
  const s = t ? stateLabel[t.state] : stateLabel.stopped;
  const link = t?.url ? `${t.url}/control#rt=${encodeURIComponent(runner.settings.token)}` : null;
  const busy = runner.status !== "open";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section className="card">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm" onClick={() => setOpen((v) => !v)}>
        <span className="font-medium">원격 접속</span>
        <span className={s.cls}>● {s.text}</span>
        {t?.url && <span className="truncate text-xs text-muted">{t.url}</span>}
        <span className="ml-auto text-xs text-muted">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">
              ngrok {t?.available.ngrok ? "설치됨" : "없음"} · cloudflared {t?.available.cloudflared ? "설치됨" : "없음"}
            </span>
            <span className="ml-auto flex gap-2">
              {t?.state === "running" || t?.state === "starting" ? (
                <button className="btn btn-danger min-h-10" disabled={busy} onClick={() => runner.tunnelAction("stop")}>
                  터널 닫기
                </button>
              ) : (
                <>
                  <button className="btn btn-primary min-h-10" disabled={busy || !t?.available.ngrok} onClick={() => runner.tunnelAction("start", "ngrok")}>
                    ngrok 열기
                  </button>
                  <button className="btn min-h-10" disabled={busy || !t?.available.cloudflared} onClick={() => runner.tunnelAction("start", "cloudflared")}>
                    cloudflared 열기
                  </button>
                </>
              )}
            </span>
          </div>
          {t?.error && <p className="mt-2 text-xs text-danger">{t.error}</p>}
          {t?.state === "running" && link && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
              {t.qrSvg ? (
                <div className="mx-auto w-[220px] max-w-full rounded-md bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: t.qrSvg }} />
              ) : (
                <div className="card flex h-[220px] w-[220px] items-center justify-center text-xs text-muted">QR 없음</div>
              )}
              <div className="min-w-0">
                <span className="label">공개 주소</span>
                <a className="block break-all font-mono text-xs text-accent underline" href={link} target="_blank" rel="noreferrer">
                  {t.url}/control
                </a>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn min-h-10" onClick={copy}>
                    {copied ? "복사됨" : "링크 복사 (토큰 포함)"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-warn">QR과 복사한 링크에는 러너 토큰이 들어 있습니다. 본인 기기에서만 열고, 공유하지 마세요.</p>
                <p className="mt-1 text-xs text-muted">
                  휴대폰: QR 스캔 → 열린 페이지에서 &quot;홈 화면에 추가&quot;로 앱처럼 설치. ngrok 무료 플랜은 첫 접속 때 경고 페이지에서 Visit Site를 눌러야 합니다.
                </p>
              </div>
            </div>
          )}
          {t?.state === "stopped" && (
            <p className="mt-2 text-xs text-muted">
              터널을 열면 이 PC의 러너(대시보드 포함)가 임시 공개 주소로 노출됩니다. 토큰 없이는 아무것도 할 수 없지만, 다 쓰면 닫아 두세요.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
