import { RARITY, type Rarity } from "@/data/species";

export function RarityTag({ rarity }: { rarity: Rarity }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color: `var(--r-${rarity})`, borderColor: `color-mix(in srgb, var(--r-${rarity}) 40%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--r-${rarity})` }} />
      {RARITY[rarity].label}
    </span>
  );
}
