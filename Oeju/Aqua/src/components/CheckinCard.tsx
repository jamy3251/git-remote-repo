"use client";

import { formatDistance } from "@/lib/geo";
import { useGeoCheckin } from "@/lib/useGeoCheckin";
import { useToday } from "@/lib/useToday";
import { isOnSiteToday, useVisits } from "@/lib/visits";

/** 홈의 현장 확인 카드. GPS로 코엑스 도착을 확인하고, 안 되면 입구 QR을 안내한다 */
export function CheckinCard() {
  const visits = useVisits();
  const onSite = isOnSiteToday(visits, useToday());
  const { state, check } = useGeoCheckin();
  const visitCount = Object.keys(visits.days).length;

  if (onSite) {
    return (
      <section className="flex items-center gap-3 rounded-3xl border border-accent/30 bg-accent/10 px-4 py-3.5">
        <Pin className="h-5 w-5 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-accent">현장 탐사 중</p>
          <p className="text-xs text-muted">오늘 포획은 경험치 1.5배 · 방문 {visitCount}회</p>
        </div>
      </section>
    );
  }

  const message = (() => {
    switch (state.kind) {
      case "locating":
        return "위치를 찾는 중... 지상에서 더 잘 잡혀요";
      case "outside":
        return `코엑스 아쿠아리움에서 ${formatDistance(state.distance)} 떨어져 있어요`;
      case "uncertain":
        return `위치 오차가 커요(약 ${formatDistance(state.accuracy)}). 입구 QR을 찍어 주세요`;
      case "denied":
        return "위치 권한이 꺼져 있어요. 입구 QR로도 확인할 수 있어요";
      case "unavailable":
        return `${state.reason}. 입구 QR을 찍어 주세요`;
      default:
        return "도착을 확인하면 오늘 포획 경험치가 1.5배";
    }
  })();

  return (
    <section className="flex items-center gap-3 rounded-3xl border border-line bg-surface px-4 py-3.5">
      <Pin className="h-5 w-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">현장 확인</p>
        <p className="text-xs leading-relaxed text-muted" aria-live="polite">
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={check}
        disabled={state.kind === "locating"}
        className="shrink-0 rounded-full border border-line px-3.5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {state.kind === "idle" ? "확인" : "다시"}
      </button>
    </section>
  );
}

function Pin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.3" fill="currentColor" />
    </svg>
  );
}
