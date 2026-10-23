import { allow, clientIp } from "@/lib/server/rateLimit";
import { isFieldKey } from "@/lib/server/secrets";

export async function POST(request: Request) {
  if (!process.env.FIELD_PASSCODE?.trim()) {
    return Response.json({ error: "현장 모드가 꺼져 있습니다 (FIELD_PASSCODE 없음)." }, { status: 503 });
  }
  if (!allow(`fa:${clientIp(request)}`, 10, 10 * 60 * 1000)) {
    return Response.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });
  }
  let body: { key?: unknown } = {};
  try {
    body = await request.json();
  } catch {}
  const ok = typeof body.key === "string" && isFieldKey(body.key);
  // 현장 모드는 QR 코드를 보여줘야 하므로 인증되면 함께 돌려준다
  return Response.json(
    ok ? { ok, checkinCode: process.env.CHECKIN_CODE?.trim() || null } : { ok },
    { status: ok ? 200 : 403 },
  );
}
