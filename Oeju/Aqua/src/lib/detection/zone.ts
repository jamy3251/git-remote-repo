import { SPECIES_BY_ID, ZONES, type ZoneId } from "@/data/species";
import type { Detection, Label } from "./types";

export function isZoneId(v: unknown): v is ZoneId {
  return typeof v === "string" && ZONES.some((z) => z.id === v);
}

/**
 * 지금 있는 구역에 살지 않는 종은 후보에서 뺀다.
 * 수조마다 사는 종이 정해져 있으므로, 구역 밖 종 이름은 거의 확실히 오인식이다.
 */
export function restrictLabel(label: Label, rawClass: string, zone: ZoneId): Label {
  if (label.kind === "species") {
    return SPECIES_BY_ID[label.speciesId].zone === zone ? label : { kind: "unknown", raw: rawClass };
  }
  if (label.kind === "group") {
    const candidates = label.candidates.filter((id) => SPECIES_BY_ID[id].zone === zone);
    if (candidates.length === 0) return { kind: "unknown", raw: rawClass };
    if (candidates.length === 1) return { kind: "species", speciesId: candidates[0] };
    return { ...label, candidates };
  }
  return label;
}

export function restrictToZone(detections: Detection[], zone: ZoneId | null): Detection[] {
  if (!zone) return detections;
  return detections.map((d) => ({ ...d, label: restrictLabel(d.label, d.rawClass, zone) }));
}
