import { SPECIES_BY_ID } from "@/data/species";
import { readRoboflowConfig } from "@/lib/detection/roboflow";
import type { Verdict } from "@/lib/detection/verify";
import { isZoneId } from "@/lib/detection/zone";
import { allow, clientIp } from "@/lib/server/rateLimit";
import { fieldKeyFrom, isFieldKey } from "@/lib/server/secrets";
import { clipBaseUrl, verifyCrops, type VerifyCrop } from "@/lib/server/verify";

const MAX_CROPS = 4;
const MAX_BASE64 = 600_000;

export interface VerifyResponse {
  verdicts: Verdict[];
}

/**
 * 2차 판정: 포획 순간 잘라낸 사진들을 CLIP으로 다시 본다.
 * 실시간 인식과 따로 돌아서 화면 속도에는 영향이 없다. 실패하면 판단 보류로 답한다.
 */
export async function POST(request: Request) {
  let body: { zone?: unknown; crops?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const crops: VerifyCrop[] = (Array.isArray(body.crops) ? body.crops : [])
    .slice(0, MAX_CROPS)
    .map((c: { image?: unknown; predicted?: unknown }) => ({
      image: typeof c?.image === "string" ? c.image.replace(/^data:image\/\w+;base64,/, "") : "",
      predicted: Array.isArray(c?.predicted) ? c.predicted.filter((id): id is string => typeof id === "string" && id in SPECIES_BY_ID) : [],
    }))
    .filter((c) => c.image && c.image.length <= MAX_BASE64 && c.predicted.length);
  if (!crops.length) return Response.json({ error: "crops가 필요합니다." }, { status: 400 });

  const config = readRoboflowConfig();
  // 키가 없으면(데모) 판정하지 않는다
  if (!config) return Response.json({ verdicts: crops.map(() => ({ kind: "unsure" })) } satisfies VerifyResponse);

  if (!isFieldKey(fieldKeyFrom(request)) && !allow(`vf:${clientIp(request)}`, 120, 60 * 60 * 1000)) {
    return Response.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  const verdicts = await verifyCrops(crops, isZoneId(body.zone) ? body.zone : null, {
    apiKey: config.apiKey,
    baseUrl: clipBaseUrl(),
  });
  return Response.json({ verdicts } satisfies VerifyResponse);
}
