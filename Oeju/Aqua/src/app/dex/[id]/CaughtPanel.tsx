"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCollection } from "@/lib/useCollection";

export function CaughtPanel({
  speciesId,
  zone,
  art,
  lockedArt,
}: {
  speciesId: string;
  zone: string;
  art: ReactNode;
  lockedArt: ReactNode;
}) {
  const entry = useCollection().caught[speciesId];

  if (!entry) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface">
        {lockedArt}
        <p className="text-sm text-muted">아직 포획하지 못했어요</p>
        <Link href={`/scan?zone=${zone}`} className="rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-accent-ink">
          찾으러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-surface-2">
        {entry.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.photo} alt="내가 포획한 사진" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          art
        )}
      </div>
      <div className="num grid grid-cols-3 divide-x divide-line text-center text-xs">
        <Stat label="포획" value={`${entry.count}회`} />
        <Stat label="최고 확신도" value={`${Math.round(entry.bestConfidence * 100)}%`} />
        <Stat label="첫 만남" value={new Date(entry.firstAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} />
      </div>
      {entry.verifiedBy === "self" && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          인식 모델은 무리까지만 알아봤고, 종은 직접 골랐어요.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-2.5">
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text">{value}</p>
    </div>
  );
}
