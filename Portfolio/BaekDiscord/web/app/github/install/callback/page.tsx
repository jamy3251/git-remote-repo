import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { canInstallApp } from "@/lib/authz";
import { newId } from "@/lib/crypto";
import { listInstallationRepos } from "@/lib/github/app";

export const dynamic = "force-dynamic";

/** Server action: attach a GitHub App installation to one of the lead's teams and pull its repo list. */
async function attachInstallation(formData: FormData) {
  "use server";
  const user = await requireUser("/teams");
  const teamId = String(formData.get("teamId") ?? "");
  const ghId = Number(formData.get("installationId"));
  if (!teamId || !Number.isFinite(ghId)) redirect("/teams");
  const db = await getDb();
  const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
  if (!canInstallApp(user, memberships, teamId)) redirect("/teams");

  const [existing] = await db.select().from(schema.installations).where(eq(schema.installations.githubInstallationId, ghId)).limit(1);
  const installationId = existing?.id ?? newId("inst");
  if (existing) {
    await db.update(schema.installations).set({ teamId, active: true, installedByUserId: user.id }).where(eq(schema.installations.id, existing.id));
  } else {
    await db.insert(schema.installations).values({ id: installationId, teamId, githubInstallationId: ghId, installedByUserId: user.id });
  }
  let repos: string[] = [];
  try {
    repos = await listInstallationRepos(ghId);
  } catch {
    // App credentials missing or API failure: the installation_repositories webhook will fill this in later.
  }
  for (const full of repos) {
    await db
      .insert(schema.teamRepos)
      .values({ teamId, repoFullName: full, installationId, active: true })
      .onConflictDoUpdate({ target: [schema.teamRepos.teamId, schema.teamRepos.repoFullName], set: { active: true, installationId } });
  }
  redirect(`/teams/${teamId}/settings`);
}

export default async function InstallCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const installationId = Number(Array.isArray(sp.installation_id) ? sp.installation_id[0] : sp.installation_id);
  const state = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const user = await requireUser(`/github/install/callback?installation_id=${installationId}${state ? `&state=${state}` : ""}`);
  if (!Number.isFinite(installationId)) {
    return <p className="text-sm text-danger">installation_id가 없습니다. GitHub App 설치 화면에서 다시 시도하세요.</p>;
  }
  const db = await getDb();
  const leadTeams = await db
    .select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(and(eq(schema.teamMembers.userId, user.id), eq(schema.teamMembers.role, "lead")));

  if (leadTeams.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm">팀장인 팀이 없습니다. 먼저 팀을 만드세요.</p>
        <a className="btn" href="/teams/new">
          팀 만들기
        </a>
      </div>
    );
  }
  const preselected = leadTeams.find((t) => t.id === state)?.id ?? (leadTeams.length === 1 ? leadTeams[0].id : undefined);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">GitHub App을 어느 팀에 붙일까요?</h1>
      <form action={attachInstallation} className="card space-y-4 p-5">
        <input type="hidden" name="installationId" value={installationId} />
        <div className="space-y-2">
          {leadTeams.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="teamId" value={t.id} defaultChecked={t.id === preselected} required />
              {t.name}
            </label>
          ))}
        </div>
        <button className="btn btn-primary">이 팀에 연결</button>
      </form>
    </div>
  );
}
