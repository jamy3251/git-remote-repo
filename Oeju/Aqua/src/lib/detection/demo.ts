import { SPECIES } from "@/data/species";
import { mapClass } from "./classMap";
import type { Detection } from "./types";

// 키 없이 화면 흐름을 확인하기 위한 가짜 탐지기.
// 7초마다 등장 생물이 바뀌고, 박스는 천천히 떠다닌다.
// 가끔 무리 단위(shark)와 미등록 클래스도 섞어서 모든 분기를 보여준다.
// 짝수 구간에는 작은 생물이 하나 더 나와서 동시 포획도 해 볼 수 있다.
const ROTATION = [
  ...SPECIES.map((s) => s.nameEn),
  "shark",
  "jellyfish",
  "diver",
];

export function demoDetections(now: number): Detection[] {
  const slot = Math.floor(now / 7000);
  const inSlot = (now % 7000) / 7000;
  // 등장 직후·퇴장 직전은 비워서 "놓쳤다"는 상황도 만든다
  if (inSlot < 0.08 || inSlot > 0.94) return [];

  const rawClass = ROTATION[slot % ROTATION.length];
  const t = now / 1000;
  const w = 0.34 + 0.04 * Math.sin(t * 0.7);
  const h = w * 0.62;
  const flicker = Math.sin(t * 5.3) > 0.85 ? 0.25 : 0;

  const main: Detection = {
    x: 0.42 + 0.12 * Math.sin(t * 0.45 + slot),
    y: 0.48 + 0.1 * Math.cos(t * 0.6 + slot),
    w,
    h,
    confidence: Math.max(0.2, 0.8 + 0.12 * Math.sin(t * 1.3) - flicker),
    rawClass,
    label: mapClass(rawClass),
  };
  if (slot % 2 === 1) return [main];
  const second = ROTATION[(slot + 5) % ROTATION.length];
  return [
    main,
    {
      x: 0.78 + 0.04 * Math.sin(t * 0.8),
      y: 0.62 + 0.05 * Math.cos(t * 0.5),
      w: 0.18,
      h: 0.12,
      confidence: 0.84 + 0.08 * Math.sin(t * 0.9),
      rawClass: second,
      label: mapClass(second),
    },
  ];
}
