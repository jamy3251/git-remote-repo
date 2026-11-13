import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { canManageTeam } from "@/lib/authz";
import { digestDateForCron, kstDateString } from "@/lib/digest/window";
import { SettingsActions } from "@/components/teams/settings-actions";

export const dynamic = "force-dynamic";

export default async function TeamSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: teamId } = await params;
  const user = await requireUser(`/teams/${teamId}/settings`);
  const db = await getDb();
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).limit(1);
  if (!team) notFound();
  const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
  const isLead = canManageTeam(user, memberships, teamId);
  const isMember = memberships.some((m) => m.teamId === teamId && m.status === "active");
  if (!isMember) notFound();

  const members = await db
    .select({ userId: schema.teamMembers.userId, handle: schema.users.handle, role: schema.teamMembers.role, status: schema.teamMembers.status })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(eq(schema.teamMembers.teamId, teamId));
  const repos = await db.select().from(schema.teamRepos).where(and(eq(schema.teamRepos.teamId, teamId), eq(schema.teamRepos.active, true)));
  const recent = await db.select().from(schema.digests).where(eq(schema.digests.teamId, teamId)).orderBy(desc(schema.digests.date)).limit(7);

  const now = new Date();
  const yesterday = kstDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const missingYesterday = !recent.some((d) => d.date === yesterday);
  const appSlug = process.env.GITHUB_APP_SLUG;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{team.name} · 설정</h1>
        <p className="text-sm text-muted">{isLead ? "팀장" : "팀원"} · 커밋 제목 노출 {team.showCommitTitles ? "켬" : "끔"}</p>
      </div>

      {team.webhookInvalid && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          웹훅 무효 — 마지막 발행이 401/404로 실패했습니다. 디스코드에서 웹훅을 새로 만들고 URL을 다시 입력하세요.
        </div>
      )}
      {missingYesterday && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          어제({yesterday}) 다이제스트가 없습니다. cron이 돌지 않았을 수 있습니다. {isLead && "아래에서 수동으로 생성하세요."}
        </div>
      )}

      <section className="card p-5">
        <h2 className="mb-3 font-medium">멤버</h2>
        <ul className="space-y-1 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2">
              <span>{m.handle}</span>
              <span className="badge">{m.role === "lead" ? "팀장" : m.status === "pending" ? "승인 대기" : "팀원"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-medium">GitHub 리포</h2>
        {repos.length === 0 ? (
          <p className="text-sm text-muted">연결된 리포가 없습니다. GitHub App을 설치하고 이 팀에 붙이세요.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {repos.map((r) => (
              <li key={r.repoFullName}>{r.repoFullName}</li>
            ))}
          </ul>
        )}
        {isLead && (
          <div className="mt-3">
            {appSlug ? (
              <a className="btn" href={`https://github.com/apps/${appSlug}/installations/new?state=${teamId}`}>
                GitHub App 설치 (읽기 전용)
              </a>
            ) : (
              <p className="text-xs text-muted">GITHUB_APP_SLUG가 설정되지 않아 설치 링크를 만들 수 없습니다.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              팀원 안내: <code>git config user.email</code>이 GitHub 계정 이메일과 같아야 커밋이 본인에게 귀속됩니다.
            </p>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-medium">최근 다이제스트</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">아직 없음</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recent.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="font-mono text-xs">{d.date}</span>
                <span className="badge">{{ published: "발행됨", skipped: "발행 없음(전원 기록 없음)", failed: "실패", draft: "초안" }[d.status]}</span>
                {d.status === "published" && (
                  <a className="text-accent underline" href={`/d/${d.id}`}>
                    편집 페이지
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLead && <SettingsActions teamId={teamId} defaultDate={digestDateForCron(now)} />}
    </div>
  );
}
