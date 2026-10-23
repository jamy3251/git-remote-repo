import { GROUP_ALIASES, SPECIES, type GroupId } from "@/data/species";
import type { Label } from "./types";

export function normalizeClass(raw: string): string {
  return raw
    // BlueTang, ClownFish 처럼 붙여 쓴 이름을 나눈다
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const speciesIndex = new Map<string, string>();
for (const s of SPECIES) {
  // id는 넣지 않는다 (예: "stingray"는 무리 이름이어야 한다)
  for (const a of [s.nameEn, s.scientific, ...s.aliases]) {
    speciesIndex.set(normalizeClass(a), s.id);
  }
}

const groupIndex = new Map<string, GroupId>();
for (const [group, aliases] of Object.entries(GROUP_ALIASES) as [GroupId, string[]][]) {
  for (const a of aliases) groupIndex.set(normalizeClass(a), group);
}

export function groupCandidates(group: GroupId): string[] {
  return SPECIES.filter((s) => s.group === group).map((s) => s.id);
}

/**
 * 로보플로우 클래스명 -> 도감 라벨.
 * 종 이름이 우선이고, 무리 이름(shark 등)이면 후보 종 목록과 함께 돌려준다.
 */
export function mapClass(raw: string): Label {
  const key = normalizeClass(raw);
  const speciesId = speciesIndex.get(key);
  if (speciesId) return { kind: "species", speciesId };

  const group = groupIndex.get(key);
  if (group) {
    const candidates = groupCandidates(group);
    if (candidates.length === 1) return { kind: "species", speciesId: candidates[0] };
    if (candidates.length > 1) return { kind: "group", group, candidates };
  }
  return { kind: "unknown", raw };
}
