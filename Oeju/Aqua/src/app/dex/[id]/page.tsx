import Link from "next/link";
import { notFound } from "next/navigation";
import { FishGlyph } from "@/components/FishGlyph";
import { RarityTag } from "@/components/RarityTag";
import { GROUP_NAMES, SPECIES, SPECIES_BY_ID, ZONE_BY_ID } from "@/data/species";
import { RECOGNITION } from "@/lib/detection/models";
import { CaughtPanel } from "./CaughtPanel";

export function generateStaticParams() {
  return SPECIES.map((s) => ({ id: s.id }));
}

export default async function SpeciesPage({ params }: PageProps<"/dex/[id]">) {
  const { id } = await params;
  const s = SPECIES_BY_ID[id];
  if (!s) notFound();
  const no = SPECIES.indexOf(s) + 1;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <Link href="/dex" className="text-sm text-muted hover:text-text">
          도감
        </Link>
        <p className="num text-sm text-muted">No.{String(no).padStart(3, "0")}</p>
      </header>

      <CaughtPanel
        speciesId={s.id}
        zone={s.zone}
        lockedArt={<FishGlyph group={s.group} color={s.color} locked className="h-28 w-28" />}
        art={<FishGlyph group={s.group} color={s.color} className="h-28 w-28" />}
      />

      <section>
        <div className="flex items-center gap-2">
          <RarityTag rarity={s.rarity} />
          <span className="text-xs text-muted">{ZONE_BY_ID[s.zone].name}</span>
          {!s.verified && <span className="text-xs text-muted">· 전시 여부 확인 중</span>}
        </div>
        <h1 className="mt-2 text-3xl font-black">{s.name}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {s.nameEn} · <i>{s.scientific}</i>
        </p>
      </section>

      <RecognitionNote level={RECOGNITION[s.id]} groupName={s.group ? GROUP_NAMES[s.group] : null} />

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">크기</dt>
          <dd className="mt-1 font-medium">{s.size}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">사는 곳</dt>
          <dd className="mt-1 font-medium">{ZONE_BY_ID[s.zone].name}</dd>
        </div>
      </dl>

      <section>
        <h2 className="mb-2 font-bold">알고 보면</h2>
        <ol className="flex flex-col gap-2">
          {s.facts.map((f, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-3 text-[15px] leading-relaxed">
              <span className="hud text-accent">{String(i + 1).padStart(2, "0")}</span>
              <span>{f}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-dashed border-accent/40 p-3">
        <p className="text-xs font-medium text-accent">포획 팁</p>
        <p className="mt-1 text-[15px] leading-relaxed">{s.tip}</p>
      </section>
    </main>
  );
}

function RecognitionNote({ level, groupName }: { level: "species" | "group" | "none"; groupName: string | null }) {
  const text =
    level === "species"
      ? "카메라가 이 종을 바로 알아봐요"
      : level === "group"
        ? `카메라는 ${groupName ?? "무리"}까지만 알아봐요. 포획한 뒤 종을 직접 골라 주세요`
        : "아직 카메라가 알아보지 못하는 생물이에요. 다음 업데이트를 기다려 주세요";
  const tone = level === "species" ? "text-accent" : level === "group" ? "text-warn" : "text-muted";
  return (
    <p className={`flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm ${tone}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {text}
    </p>
  );
}
