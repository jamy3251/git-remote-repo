import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { publicBaseUrl } from "@/lib/base-url";
import { DigestNotFoundError, EditWindowClosedError, ForbiddenError, updateDigestRow } from "@/lib/digest/pipeline";
import { WebhookInvalidError } from "@/lib/discord";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  excludedEventIds: z.array(z.string()).optional(),
  blockedNote: z.string().max(300).nullable().optional(),
  optedOut: z.boolean().optional(),
});

/** 본인 행만 PATCH. 타인 행/다른 팀 → 403, 60분 경과 → 409. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const db = await getDb();
  try {
    await updateDigestRow(db, user.id, id, parsed.data, { baseUrl: publicBaseUrl(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DigestNotFoundError) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (e instanceof EditWindowClosedError) return NextResponse.json({ error: "edit window closed" }, { status: 409 });
    if (e instanceof WebhookInvalidError) return NextResponse.json({ error: "webhook invalid" }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
