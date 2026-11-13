"use client";

import { useState } from "react";

/** What the Android shell (android/) exposes as `window.DevHubApp`. */
interface DevHubAppBridge {
  isApp(): boolean;
  version(): string;
  backgroundAlerts(): boolean;
  setBackgroundAlerts(on: boolean): void;
  resetConnection(): void;
}

export function appBridge(): DevHubAppBridge | null {
  const b = (window as unknown as { DevHubApp?: DevHubAppBridge }).DevHubApp;
  try {
    return b && b.isApp() ? b : null;
  } catch {
    return null;
  }
}

/** Settings that only exist inside the Android app. Renders nothing in a browser. */
export function AppPanel() {
  const [bridge] = useState(appBridge);
  const [alerts, setAlerts] = useState(() => bridge?.backgroundAlerts() ?? false);
  if (!bridge) return null;

  return (
    <section className="card px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">앱</span>
        <span className="text-xs text-muted">DevHub 관제 {bridge.version()}</span>
      </div>
      <label className="mt-2 flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-accent"
          checked={alerts}
          onChange={(e) => {
            bridge.setBackgroundAlerts(e.target.checked);
            setAlerts(e.target.checked);
          }}
        />
        <span>
          백그라운드 알림
          <span className="block text-xs text-muted">앱을 닫아도 입력 대기·오류·작업 완료·교차검증 결과를 알림으로 받습니다. 켜 두는 동안 상단에 연결 유지 알림이 보이고 배터리를 조금 씁니다.</span>
        </span>
      </label>
      <button className="btn mt-2 min-h-10 text-xs" onClick={() => bridge.resetConnection()}>
        다른 러너에 연결 (QR 다시 찍기)
      </button>
    </section>
  );
}
