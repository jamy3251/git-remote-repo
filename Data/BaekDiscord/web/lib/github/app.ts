import { importPKCS8, SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { CompareCommit, CompareFetch } from "@/lib/digest/pipeline";

/** GitHub App JWT (RS256, 10 min) for installation-token exchange. */
export async function appJwt(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !pem) throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY missing");
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(key);
}

export async function installationToken(installationId: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { authorization: `Bearer ${await appJwt()}`, accept: "application/vnd.github+json", "user-agent": "devhub" },
  });
  if (!res.ok) throw new Error(`installation token failed: ${res.status}`);
  const json = (await res.json()) as { token: string };
  return json.token;
}

/** Repos visible to an installation (for the install callback → team_repos). */
export async function listInstallationRepos(installationId: number, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const token = await installationToken(installationId, fetchImpl);
  const names: string[] = [];
  for (let page = 1; page < 20; page++) {
    const res = await fetchImpl(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "devhub" },
    });
    if (!res.ok) throw new Error(`installation repositories failed: ${res.status}`);
    const json = (await res.json()) as { repositories: { full_name: string }[] };
    names.push(...json.repositories.map((r) => r.full_name));
    if (json.repositories.length < 100) break;
  }
  return names;
}

/** Compare API fetcher bound to a team's installation (used by the cron backfill step). */
export function makeCompareFetch(db: Db, teamId: string, fetchImpl: typeof fetch = fetch): CompareFetch {
  return async (repo, before, after) => {
    const [row] = await db
      .select({ ghId: schema.installations.githubInstallationId })
      .from(schema.teamRepos)
      .innerJoin(schema.installations, eq(schema.installations.id, schema.teamRepos.installationId))
      .where(and(eq(schema.teamRepos.teamId, teamId), eq(schema.teamRepos.repoFullName, repo)))
      .limit(1);
    if (!row) return [];
    const token = await installationToken(row.ghId, fetchImpl);
    const out: CompareCommit[] = [];
    for (let page = 1; page < 10; page++) {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}/compare/${before}...${after}?per_page=250&page=${page}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "devhub" },
      });
      if (!res.ok) throw new Error(`compare failed: ${res.status}`);
      const json = (await res.json()) as {
        commits: { sha: string; commit: { message: string; author?: { date?: string } }; author?: { login?: string } | null }[];
      };
      for (const c of json.commits) {
        out.push({
          sha: c.sha,
          title: c.commit.message.split("\n")[0].slice(0, 200),
          login: c.author?.login ?? null,
          authoredAt: c.commit.author?.date ?? null,
        });
      }
      if (json.commits.length < 250) break;
    }
    return out;
  };
}
