import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchProfile, upsertGitHubUser } from "@/lib/auth/github";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const stored = req.cookies.get("devhub_oauth_state")?.value ?? "";
  const [expectedState, next = "/"] = stored.split("|");
  if (!code || !state || state !== expectedState) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }
  try {
    const redirectUri = `${req.nextUrl.origin}/api/auth/github/callback`;
    const token = await exchangeCode(code, redirectUri);
    const profile = await fetchProfile(token);
    const db = await getDb();
    const { userId } = await upsertGitHubUser(db, profile);
    await createSession(userId);
    const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.nextUrl.origin));
    res.cookies.delete("devhub_oauth_state");
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
