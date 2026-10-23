import { timingSafeEqual } from "node:crypto";

/** 길이가 달라도 시간 차이로 새지 않게 비교 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** 현장(관리자) 모드 인증. FIELD_PASSCODE 가 없으면 현장 모드는 꺼진다 */
export function isFieldKey(
  value: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const pass = env.FIELD_PASSCODE?.trim();
  return !!pass && !!value && safeEqual(value.trim(), pass);
}

export function fieldKeyFrom(request: Request): string | null {
  return request.headers.get("x-field-key");
}
