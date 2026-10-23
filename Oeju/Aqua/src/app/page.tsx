"use client";

import Link from "next/link";
import { CheckinCard } from "@/components/CheckinCard";
import { FishGlyph } from "@/components/FishGlyph";
import { RARITY, SPECIES, SPECIES_BY_ID, ZONE_BY_ID, ZONES } from "@/data/species";
import { caughtOnDay, dailyMissions, levelOf, levelRange, zoneProgress } from "@/lib/collection";
import { useCollection } from "@/lib/useCollection";
import { useToday } from "@/lib/useToday";

export default function Home() {
  const collection = useCollection();
  const today = useToday();
  const level = levelOf(collection.xp);
  const range = levelRange(level);
  const pct = ((collection.xp - range.from) / (range.to - range.from)) * 100;
  const caughtCount = Object.keys(collection.caught).length;
  const missions = today ? dailyMissions(today) : [];
  const missionsDone = today ? missions.filter((id) => caughtOnDay(collection.caught[id], today)).length : 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex h-12 items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-[10px]" />
          <h1 className="text-lg font-black tracking-tight">아쿠아 도감</h1>
        </div>
        <Link href="/dex" className="rounded-full border border-line px-3 py-1.5 text-sm">
          도감 <span className="num text-muted">{caughtCount}/{SPECIES.length}</span>
        </Link>
      </header>

      {/* 등급 + 탐사 시작 */}
      <section className="overflow-hidden rounded-[28px] border border-line bg-[radial-gradient(120%_90%_at_100%_0%,#0f3442_0%,var(--surface)_60%)]">
        <div className="flex items-end justify-between px-5 pt-5">
          <div>
            <p className="text-xs text-muted">탐사 등급</p>
            <p className="num mt-1 text-5xl font-black leading-none tracking-tight">Lv.{level}</p>
          </div>
          <p className="pb-1 text-xs text-muted">
            다음 등급까지 <span className="num font-bold text-text">{range.to - collection.xp}</span> XP
          </p>
        </div>
        <div className="mx-5 mt-4 h-1.5 overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <Link
          href="/scan"
          className="m-3 mt-5 flex items-center justify-between rounded-[20px] bg-accent px-5 py-4 text-accent-ink active:brightness-95"
        >
          <div>
            <p className="text-xl font-black">탐사 시작</p>
            <p className="text-sm opacity-75">수조에 카메라를 대고 포획하기</p>
          </div>
          <svg viewBox="0 0 48 48" className="h-10 w-10 shrink-0" aria-hidden>
            <path d="M8 18V8h10M30 8h10v10M40 30v10H30M18 40H8V30" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="24" r="4.5" fill="currentColor" />
          </svg>
        </Link>
      </section>

      <CheckinCard />

      <section className="mt-2">
        <div className="mb-2.5 flex items-baseline justify-between px-1">
          <h2 className="font-bold">오늘의 탐사</h2>
          <p className="num text-xs text-muted">{today ? `${missionsDone}/${missions.length}` : ""}</p>
        </div>
        <ul className="overflow-hidden rounded-3xl border border-line bg-surface">
          {missions.map((id, i) => {
            const s = SPECIES_BY_ID[id];
            const done = today ? caughtOnDay(collection.caught[id], today) : false;
            const known = !!collection.caught[id];
            return (
              <li key={id} className={i > 0 ? "border-t border-line" : ""}>
                <Link href={`/dex/${id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2">
                    <FishGlyph group={s.group} color={s.color} locked={!known} className="h-8 w-8" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {known ? s.name : `${ZONE_BY_ID[s.zone].name}의 ${RARITY[s.rarity].label} 생물`}
                    </p>
                    <p className="text-xs text-muted">
                      {known ? ZONE_BY_ID[s.zone].name : "아직 만나지 못했어요"} ·{" "}
                      <span className="num">No.{String(SPECIES.indexOf(s) + 1).padStart(3, "0")}</span>
                    </p>
                  </div>
                  {done ? (
                    <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-ink">완료</span>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" aria-hidden>
                      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </Link>
              </li>
            );
          })}
          {!today && <li className="h-[200px]" />}
        </ul>
      </section>

      <section className="mt-2">
        <h2 className="mb-2.5 px-1 font-bold">구역 수집률</h2>
        <ul className="grid grid-cols-2 gap-2">
          {ZONES.map((z, i) => {
            const p = zoneProgress(collection, z.id);
            const complete = p.total > 0 && p.caught === p.total;
            // 홀수 개면 마지막 칸을 가로로 꽉 채워 빈칸을 없앤다
            const wide = ZONES.length % 2 === 1 && i === ZONES.length - 1;
            return (
              <li key={z.id} className={wide ? "col-span-2" : ""}>
                <Link href={`/dex?zone=${z.id}`} className="block rounded-3xl border border-line bg-surface p-4 active:bg-surface-2">
                  <p className="text-sm font-medium">{z.name}</p>
                  <p className={`num mt-3 text-2xl font-black ${complete ? "text-accent" : ""}`}>
                    {p.caught}
                    <span className="text-sm text-muted">/{p.total}</span>
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${p.total ? (p.caught / p.total) * 100 : 0}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-4 text-center text-[11px] leading-relaxed text-muted/70">
        생물 정보와 전시 여부는 현장 확인 전 초안이에요.
      </footer>
    </main>
  );
}
