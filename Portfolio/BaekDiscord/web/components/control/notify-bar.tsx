"use client";

import type { AttentionApi } from "@/lib/runner/use-attention";
import { notifyModeLabel, notifyModes } from "@/lib/runner/notify-settings";

/**
 * Browser-notification controls: permission button, quiet mode, and what the badge counts.
 * Quiet modes mirror a desktop "focus assist": all / priority only / off.
 */
export function NotifyBar({ attention, compact = false }: { attention: AttentionApi; compact?: boolean }) {
  const { permission, prefs, setMode, requestPermission, count } = attention;
  return (
    <section className={`card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm ${compact ? "" : ""}`}>
      <span className="font-medium">알림</span>
      {permission === "unsupported" && <span className="text-xs text-muted">이 브라우저는 알림을 지원하지 않습니다</span>}
      {permission === "denied" && <span className="text-xs text-danger">브라우저에서 차단됨 · 주소창 자물쇠에서 허용</span>}
      {permission === "default" && (
        <button className="btn min-h-9 text-xs" onClick={() => void requestPermission()}>
          브라우저 알림 켜기
        </button>
      )}
      {permission === "granted" && (
        <label className="flex items-center gap-2 text-xs text-muted">
          방해 금지
          <select className="input min-h-9 w-auto" value={prefs.mode} onChange={(e) => setMode(e.target.value as typeof prefs.mode)}>
            {notifyModes.map((m) => (
              <option key={m} value={m}>
                {notifyModeLabel[m]}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="text-xs text-muted sm:ml-auto" title="입력 대기·오류·제안이 있는 실행 중 세션 수. 탭 제목과 앱 아이콘 배지에 표시됩니다.">
        주의 {count}
        {count > 0 ? " · 화면을 보고 있을 때는 알림을 띄우지 않습니다" : ""}
      </span>
    </section>
  );
}
