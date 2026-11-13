import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { runDigestForTeam } from "@/lib/digest/pipeline";
import { digestDateForCron } from "@/lib/digest/window";
import { makeCompareFetch } from "@/lib/github/app";
import { getSessionUser } from "@/lib/auth/session";
import { canTriggerDigest } from "@/lib/authz";
import { publicBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel cron (Authorization: Bearer CRON_SECRET) or a lead's manual trigger (session + ?team=). */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  const teamParam = req.nextUrl.searchParams.get("team");
  const date = req.nextUrl.searchParams.get("date") ?? digestDateForCron(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 });

  const db = await getDb();
  let teamIds: string[];
  if (cronOk) {
    teamIds = teamParam ? [teamParam] : (await db.select({ id: schema.teams.id }).from(schema.teams)).map((t) => t.id);
  } else {
    // manual trigger: lead of the team only
    const user = await getSessionUser();
    if (!user || !teamParam) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
    if (!canTriggerDigest(user, memberships, teamParam)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    teamIds = [teamParam];
  }

  const results = [];
  for (const teamId of teamIds) {
    try {
      const r = await runDigestForTeam(db, teamId, date, {
        baseUrl: publicBaseUrl(req),
        compareFetch: process.env.GITHUB_APP_ID ? makeCompareFetch(db, teamId) : undefined,
      });
      results.push({ teamId, ...r });
    } catch (e) {
      results.push({ teamId, status: "error", error: (e as Error).message });
    }
  }
  return NextResponse.json({ date, results });
}

export const POST = GET;
