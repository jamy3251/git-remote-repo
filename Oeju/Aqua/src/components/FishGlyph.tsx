import type { GroupId } from "@/data/species";

// 사진이 없을 때 쓰는 단순 실루엣. 무리별로 윤곽만 다르게 한다.
const PATHS: Record<GroupId | "fish", string> = {
  fish: "M6 32c7-10 17-15 28-15 7 0 12 3 17 8l9-7v28l-9-7c-5 5-10 8-17 8-11 0-21-5-28-15z",
  shark:
    "M4 34c10-6 22-9 34-9l6-11 4 11c5 1 9 3 12 5l4-6v20l-4-6c-4 3-9 5-15 5l-2 7-5-7c-14 0-25-3-34-9z",
  ray: "M32 14c10 0 26 12 28 18-6 2-15 2-22 4l-6 14-6-14c-7-2-16-2-22-4 2-6 18-18 28-18z",
  jelly:
    "M14 30c0-10 8-17 18-17s18 7 18 17c0 2-2 3-4 3H18c-2 0-4-1-4-3zm6 6c0 8-2 12-2 16m8-16c0 10 1 14 0 18m8-18c0 9 1 13 2 17m6-17c0 7 2 11 3 14",
  turtle:
    "M18 32c0-9 7-15 15-15s15 6 15 15-7 13-15 13-15-4-15-13zm30-2c4-2 8-2 11 1-3 3-7 3-11 1zM20 22l-8-6m8 26l-8 6m30-26l6-6m-6 26l6 6",
  eel: "M4 38c8-10 16-10 24-4s16 6 24-2c3-3 6-4 8-3-1 5-5 9-9 11-9 6-18 3-24-1s-13-5-23-1z",
  puffer:
    "M14 32c0-10 8-17 18-17s18 7 18 17-8 17-18 17-18-7-18-17zm36-4l8-5v18l-8-5M24 14l-2-5m10 4V8m10 7l3-5M22 50l-2 5m12-4v5m10-6l3 5",
};

export function FishGlyph({
  group,
  color,
  locked,
  className,
}: {
  group?: GroupId;
  color: string;
  locked?: boolean;
  className?: string;
}) {
  const d = PATHS[group ?? "fish"];
  const isLine = group === "jelly" || group === "turtle" || group === "puffer";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path
        d={d}
        fill={locked ? "#1d3a48" : color}
        stroke={isLine ? (locked ? "#2a4b5b" : color) : "none"}
        strokeWidth={isLine ? 2.5 : 0}
        strokeLinecap="round"
        fillRule="evenodd"
        opacity={locked ? 1 : 0.92}
      />
    </svg>
  );
}
