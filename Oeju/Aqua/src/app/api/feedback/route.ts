import { readRoboflowConfig } from "@/lib/detection/roboflow";
import { isZoneId } from "@/lib/detection/zone";
import { readFeedbackProject, uploadToRoboflow, type FeedbackKind } from "@/lib/server/feedback";
import { allow, clientIp } from "@/lib/server/rateLimit";
import { fieldKeyFrom, isFieldKey } from "@/lib/server/secrets";

const MAX_BASE64 = 3_000_000;

/**
 * 현장 피드백을 Roboflow 프로젝트로 올린다.
 * - misid: 일반 관람객이 "아니에요"를 누른 사진 (물고기 주변만 잘린 사진)
 * - field: 현장 모드에서 직접 찍은 학습용 사진 (현장 암호 필요)
 */
export async function POST(request: Request) {
  const config = readRoboflowConfig();
  const project = readFeedbackProject();
  if (!config || !project) {
    return Response.json({ error: "피드백 업로드가 설정되지 않았습니다." }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  const kind: FeedbackKind | null = body.kind === "misid" || body.kind === "field" ? body.kind : null;
  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  if (!kind || !image || image.length > MAX_BASE64) {
    return Response.json({ error: "kind, image가 필요합니다." }, { status: 400 });
  }

  const field = isFieldKey(fieldKeyFrom(request));
  if (kind === "field" && !field) return Response.json({ error: "현장 모드 인증이 필요합니다." }, { status: 401 });
  // 현장 모드는 넉넉히, 일반 관람객은 시간당 30장
  if (!field && !allow(`fb:${clientIp(request)}`, 30, 60 * 60 * 1000)) {
    return Response.json({ error: "잠시 후 다시 보내 주세요." }, { status: 429 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : null);
  try {
    const result = await uploadToRoboflow(
      { apiKey: config.apiKey, project },
      image,
      {
        kind,
        zone: isZoneId(body.zone) ? body.zone : null,
        predicted: str(body.predicted),
        rawClass: str(body.rawClass),
        actual: str(body.actual),
        clip: str(body.clip),
        model: str(body.model),
        confidence: typeof body.confidence === "number" ? body.confidence : null,
      },
      AbortSignal.timeout(15_000),
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[feedback]", err);
    return Response.json({ error: "업로드에 실패했습니다." }, { status: 502 });
  }
}
