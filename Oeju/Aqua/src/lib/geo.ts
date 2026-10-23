// 코엑스 도착 확인. 아쿠아리움은 지하라 GPS는 지상(입구 근처)에서만 의미가 있다.
// 좌표: 위키백과(37.5125, 127.0589)와 지도 서비스(37.5132, 127.0586)의 중간값.
export const COEX_AQUARIUM = { lat: 37.5128, lng: 127.0588 };
/** 코엑스몰 전체와 지상 출입구를 덮는 반경 */
export const CHECKIN_RADIUS_M = 450;
/** 이보다 오차가 크면 판단하지 않는다 (와이파이·기지국 추정) */
export const MAX_ACCURACY_M = 300;

export interface Fix {
  lat: number;
  lng: number;
  /** 미터, 68% 신뢰 반경 */
  accuracy: number;
}

export type GeoVerdict =
  | { kind: "inside"; distance: number }
  | { kind: "outside"; distance: number }
  | { kind: "uncertain"; distance: number; accuracy: number };

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function judgeFix(fix: Fix, target = COEX_AQUARIUM, radius = CHECKIN_RADIUS_M): GeoVerdict {
  const distance = Math.round(distanceM(fix, target));
  // 오차 원 전체가 반경 밖이면 확실히 밖 (오차가 커도 멀리 있는 건 알 수 있다)
  if (distance - fix.accuracy > radius) return { kind: "outside", distance };
  if (fix.accuracy > MAX_ACCURACY_M) return { kind: "uncertain", distance, accuracy: Math.round(fix.accuracy) };
  if (distance <= radius) return { kind: "inside", distance };
  return { kind: "uncertain", distance, accuracy: Math.round(fix.accuracy) };
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}
