"use client";

/** Always visible in `npm run demo`, so sample sessions are never mistaken for real ones. */
export function DemoBanner({ demo }: { demo: boolean | undefined }) {
  if (!demo) return null;
  return (
    <div className="border-b border-border bg-surface px-3 py-1.5 text-xs" role="note">
      <span className="font-medium text-warn">데모</span>
      <span className="text-muted"> · 가짜 세션입니다. PC에서 실제로 실행되는 것은 없습니다.</span>
    </div>
  );
}
