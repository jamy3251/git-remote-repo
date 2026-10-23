import { connection } from "next/server";
import { demoDetections } from "@/lib/detection/demo";
import { detectWithModel, detectWithModels, readRoboflowConfig } from "@/lib/detection/roboflow";
import type { DetectResponse, DetectStatus } from "@/lib/detection/types";
import { postProcess } from "@/lib/detection/pipeline";
import { isZoneId, restrictToZone } from "@/lib/detection/zone";
import { fieldKeyFrom, isFieldKey } from "@/lib/server/secrets";

const MAX_BASE64 = 2_000_000;
/** 이 서버 프로세스에서 한 번이라도 응답한 모델 */
const warmed = new Set<string>();

export async function GET() {
  await connection();
  const config = readRoboflowConfig();
  const status: DetectStatus = config ? { mode: "roboflow", models: config.models } : { mode: "demo", models: [] };
  return Response.json(status);
}

export async function POST(request: Request) {
  const started = Date.now();
  const config = readRoboflowConfig();

  let body: { image?: unknown; width?: unknown; height?: unknown; zone?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const zone = isZoneId(body.zone) ? body.zone : null;

  if (!config) {
    const res: DetectResponse = {
      mode: "demo",
      detections: restrictToZone(demoDetections(started), zone),
      latencyMs: Date.now() - started,
      runs: [],
    };
    return Response.json(res);
  }

  const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
  const width = Number(body.width);
  const height = Number(body.height);
  if (!image || image.length > MAX_BASE64 || !(width > 0) || !(height > 0)) {
    return Response.json({ error: "image(base64), width, height가 필요합니다." }, { status: 400 });
  }

  // 모델별로 따로 시간 제한. 느린 모델 하나가 전체를 붙잡지 않게 한다.
  // 서버리스 모델은 처음 깨어날 때 6초를 넘기므로(실측) 첫 성공 전까지는 넉넉히 준다.
  const sent = { width, height };
  try {
    const { runs, perModel: original } = await detectWithModels(
      config.models,
      async (model) => {
        const result = await detectWithModel(
          config,
          model,
          image,
          sent,
          AbortSignal.timeout(warmed.has(model) ? 6000 : 20000),
        );
        warmed.add(model);
        return result;
      },
    );
    // 구역 필터 → 병합 → 1단계 거름 (평가 도구와 같은 함수)
    const { detections, perModel } = postProcess(original, { zone, guard: true });
    const res: DetectResponse = {
      mode: "roboflow",
      detections,
      latencyMs: Date.now() - started,
      runs,
      raw: isFieldKey(fieldKeyFrom(request)) ? perModel : undefined,
    };
    return Response.json(res);
  } catch {
    return Response.json({ error: "인식 서버 응답이 없습니다." }, { status: 502 });
  }
}
