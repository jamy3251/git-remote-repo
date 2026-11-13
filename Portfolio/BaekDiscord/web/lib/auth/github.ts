import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/crypto";

export function githubAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface GitHubProfile {
  id: number;
  login: string;
  avatar_url?: string;
  name?: string | null;
}

export async function exchangeCode(code: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) throw new Error(`github token exchange failed: ${json.error ?? res.status}`);
  return json.access_token;
}

export async function fetchProfile(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<GitHubProfile> {
  const res = await fetchImpl("https://api.github.com/user", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "devhub" },
  });
  if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
  return (await res.json()) as GitHubProfile;
}

/** Upsert users + identities keyed by numeric GitHub id; refresh login/avatar on every login. */
export async function upsertGitHubUser(db: Db, profile: GitHubProfile): Promise<{ userId: string }> {
  const externalId = String(profile.id);
  const [existing] = await db
    .select()
    .from(schema.identities)
    .where(and(eq(schema.identities.provider, "github"), eq(schema.identities.externalId, externalId)))
    .limit(1);
  if (existing) {
    await db.update(schema.identities).set({ githubLogin: profile.login }).where(eq(schema.identities.id, existing.id));
    await db
      .update(schema.users)
      .set({ handle: profile.login, avatar: profile.avatar_url ?? null })
      .where(eq(schema.users.id, existing.userId));
    return { userId: existing.userId };
  }
  const userId = newId("u");
  await db.insert(schema.users).values({ id: userId, handle: profile.login, avatar: profile.avatar_url ?? null });
  await db.insert(schema.identities).values({
    id: newId("idn"),
    userId,
    provider: "github",
    externalId,
    githubLogin: profile.login,
  });
  return { userId };
}
