import { NextResponse, type NextRequest } from "next/server";
import { upsertGitHubUser } from "@/lib/auth/github";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Local-only sign-in without GitHub, for exercising the team/digest pages before
 * OAuth credentials exist. Enabled only when DEV_LOGIN=1 and not in production.
 * `?login=<handle>` picks the fake GitHub login (default "dev-user").
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN !== "1") {
    return NextResponse.json({ error: "dev login disabled" }, { status: 404 });
  }
  const login = (req.nextUrl.searchParams.get("login") ?? "dev-user").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 39) || "dev-user";
  const next = req.nextUrl.searchParams.get("next") ?? "/teams";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/teams";
  // Deterministic fake numeric id per login so re-login maps to the same user.
  let id = 900_000_000;
  for (const ch of login) id = (id * 31 + ch.charCodeAt(0)) % 2_000_000_000;
  const db = await getDb();
  const { userId } = await upsertGitHubUser(db, { id, login, name: login });
  await createSession(userId);
  return NextResponse.redirect(new URL(safeNext, req.nextUrl.origin));
}
