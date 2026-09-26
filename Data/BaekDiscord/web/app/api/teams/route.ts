import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { encryptSecret, newId } from "@/lib/crypto";
import { isDiscordWebhookUrl, sendTestMessage, WebhookInvalidError } from "@/lib/discord";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  webhookUrl: z.string().trim().url(),
  showCommitTitles: z.boolean().default(false),
});

/** 팀 생성: 웹훅 URL은 테스트 메시지로 검증한 뒤에만 저장한다. 생성자는 lead. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "입력값을 확인하세요." }, { status: 400 });
  const { name, webhookUrl, showCommitTitles } = parsed.data;
  if (!isDiscordWebhookUrl(webhookUrl)) {
    return NextResponse.json({ error: "디스코드 웹훅 URL 형식이 아닙니다." }, { status: 400 });
  }
  try {
    await sendTestMessage(webhookUrl, name);
  } catch (e) {
    const msg = e instanceof WebhookInvalidError ? "웹훅이 유효하지 않습니다 (401/404). 채널에서 새로 만들어 주세요." : `웹훅 테스트 실패: ${(e as Error).message}`;
    return NextResponse.json({ error: msg }, { status: 422 });
  }
  const db = await getDb();
  const teamId = newId("t");
  await db.insert(schema.teams).values({
    id: teamId,
    name,
    discordWebhookUrlEnc: encryptSecret(webhookUrl),
    showCommitTitles,
  });
  await db.insert(schema.teamMembers).values({ teamId, userId: user.id, role: "lead", status: "active" });
  return NextResponse.json({ ok: true, teamId }, { status: 201 });
}
