import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { githubAuthorizeUrl } from "@/lib/auth/github";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    // Not configured yet: explain on the home page instead of bouncing to GitHub with an empty client id.
    const url = new URL("/", req.nextUrl.origin);
    url.searchParams.set("setup", "github-oauth");
    url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url);
  }

  const state = randomBytes(12).toString("base64url");
  const redirectUri = `${req.nextUrl.origin}/api/auth/github/callback`;
  const res = NextResponse.redirect(githubAuthorizeUrl(state, redirectUri));
  res.cookies.set("devhub_oauth_state", `${state}|${safeNext}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
