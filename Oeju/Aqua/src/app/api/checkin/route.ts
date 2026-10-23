import { safeEqual } from "@/lib/server/secrets";
import { allow, clientIp } from "@/lib/server/rateLimit";

/** 입구 QR 도착 확인. 코드는 서버에만 두어 앱 번들로 새지 않게 한다 */
export async function POST(request: Request) {
  const code = process.env.CHECKIN_CODE?.trim();
  if (!code) return Response.json({ error: "QR 도착 확인이 꺼져 있습니다." }, { status: 503 });
  if (!allow(`ci:${clientIp(request)}`, 20, 10 * 60 * 1000)) {
    return Response.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });
  }
  let body: { code?: unknown } = {};
  try {
    body = await request.json();
  } catch {}
  const ok = typeof body.code === "string" && safeEqual(body.code.trim(), code);
  return Response.json({ ok }, { status: ok ? 200 : 403 });
}
