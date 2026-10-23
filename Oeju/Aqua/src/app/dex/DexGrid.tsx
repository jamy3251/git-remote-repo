"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FishGlyph } from "@/components/FishGlyph";
import { SPECIES, ZONES, type ZoneId } from "@/data/species";
import { RECOGNITION } from "@/lib/detection/models";
import { downloadReports, useReports } from "@/lib/reports";
import { useCollection } from "@/lib/useCollection";

export function DexGrid() {
  const params = useSearchParams();
  const zoneParam = params.get("zone");
  const zone = ZONES.some((z) => z.id === zoneParam) ? (zoneParam as ZoneId) : null;
  const collection = useCollection();
  const reports = useReports();
  const list = zone ? SPECIES.filter((s) => s.zone === zone) : SPECIES;
  const caught = list.filter((s) => collection.caught[s.id]).length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted hover:text-text">
          홈
        </Link>
        <h1 className="text-lg font-bold">도감</h1>
        <p className="num w-10 text-right text-sm text-muted">
          {caught}/{list.length}
        </p>
      </header>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <ZoneChip href="/dex" active={!zone} label="전체" />
        {ZONES.map((z) => (
          <ZoneChip key={z.id} href={`/dex?zone=${z.id}`} active={zone === z.id} label={z.name} />
        ))}
      </nav>

      <ul className="grid grid-cols-3 gap-2">
        {list.map((s) => {
          const entry = collection.caught[s.id];
          const no = SPECIES.indexOf(s) + 1;
          const unsupported = !entry && RECOGNITION[s.id] === "none";
          return (
            <li key={s.id}>
              <Link
                href={`/dex/${s.id}`}
                className={`flex aspect-[3/4] flex-col overflow-hidden rounded-2xl border bg-surface ${unsupported ? "opacity-55" : ""}`}
                style={{ borderColor: entry ? `color-mix(in srgb, var(--r-${s.rarity}) 45%, var(--line))` : "var(--line)" }}
              >
                <div className="relative flex flex-1 items-center justify-center bg-surface-2">
                  {entry?.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.photo} alt={s.name} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <FishGlyph group={s.group} color={s.color} locked={!entry} className="h-16 w-16" />
                  )}
                  <span className="num absolute left-2 top-1.5 text-[10px] text-muted">
                    {String(no).padStart(3, "0")}
                  </span>
                  <span
                    className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
                    style={{ background: `var(--r-${s.rarity})` }}
                    aria-hidden
                  />
                </div>
                <p className={`truncate px-2 py-1.5 text-center text-xs ${entry ? "font-medium" : "text-muted"}`}>
                  {entry ? s.name : unsupported ? "인식 준비 중" : "???"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>

      {reports.length > 0 && (
        <button
          type="button"
          onClick={() => downloadReports(reports)}
          className="self-center text-xs text-muted underline underline-offset-4"
        >
          인식 오류 기록 {reports.length}건 내보내기 (학습용)
        </button>
      )}

      <Link
        href="/scan"
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-accent px-6 py-3 font-bold text-accent-ink shadow-lg shadow-black/40"
      >
        탐사하러 가기
      </Link>
    </main>
  );
}

function ZoneChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      replace
      className={`flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-sm ${active ? "bg-text font-medium text-bg" : "border border-line text-muted"}`}
    >
      {label}
    </Link>
  );
}
