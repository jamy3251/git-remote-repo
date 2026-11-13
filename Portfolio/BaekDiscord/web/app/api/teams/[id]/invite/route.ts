import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getSessionUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { canManageTeam } from "@/lib/authz";
import { publicBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";
const INVITE_DAYS = 7;

/** lead만 초대 링크를 만든다 (7일 만료). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: teamId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
  if (!canManageTeam(user, memberships, teamId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const token = randomBytes(16).toString("base64url");
  await db.insert(schema.invites).values({
    token,
    teamId,
    createdBy: user.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });
  return NextResponse.json({ ok: true, token, url: `${publicBaseUrl(req)}/join/${token}` }, { status: 201 });
}
