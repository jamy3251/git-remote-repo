import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { canJoinViaInvite, isContributor } from "@/lib/authz";

export const dynamic = "force-dynamic";

async function join(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const user = await requireUser(`/join/${token}`);
  const db = await getDb();
  const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.token, token)).limit(1);
  if (!canJoinViaInvite(invite, new Date())) redirect(`/join/${token}?expired=1`);

  const [ident] = await db
    .select({ login: schema.identities.githubLogin })
    .from(schema.identities)
    .where(and(eq(schema.identities.userId, user.id), eq(schema.identities.provider, "github")))
    .limit(1);
  const repos = (
    await db.select({ repo: schema.teamRepos.repoFullName }).from(schema.teamRepos).where(eq(schema.teamRepos.teamId, invite.teamId))
  ).map((r) => r.repo);
  const logins =
    repos.length === 0
      ? []
      : (
          await db
            .selectDistinct({ login: schema.activityEvents.githubLogin })
            .from(schema.activityEvents)
            .where(inArray(schema.activityEvents.repo, repos))
        ).map((r) => r.login);
  const contributor = isContributor(ident?.login, logins);
  await db
    .insert(schema.teamMembers)
    .values({ teamId: invite.teamId, userId: user.id, role: "member", status: contributor ? "active" : "pending" })
    .onConflictDoNothing();
  redirect(contributor ? `/teams/${invite.teamId}/settings` : `/join/${token}?pending=1`);
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  await requireUser(`/join/${token}`);
  const db = await getDb();
  const [invite] = await db
    .select({ teamName: schema.teams.name, expiresAt: schema.invites.expiresAt, teamId: schema.invites.teamId })
    .from(schema.invites)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.invites.teamId))
    .where(eq(schema.invites.token, token))
    .limit(1);

  if (!invite || sp.expired || !canJoinViaInvite({ token, teamId: invite.teamId, expiresAt: invite.expiresAt }, new Date())) {
    return <p className="text-sm text-danger">초대 링크가 없거나 만료되었습니다. 팀장에게 새 링크를 요청하세요.</p>;
  }
  if (sp.pending) {
    return (
      <div className="card max-w-lg space-y-2 p-5 text-sm">
        <p className="font-medium">{invite.teamName} 합류 요청이 접수되었습니다.</p>
        <p className="text-muted">
          팀 리포에 커밋 기록이 아직 없어 승인 대기 상태입니다. 커밋을 올리거나 팀장이 승인하면 다이제스트에 포함됩니다.
        </p>
      </div>
    );
  }
  return (
    <form action={join} className="card max-w-lg space-y-4 p-5">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm">
        <span className="font-medium">{invite.teamName}</span> 팀에 합류합니다. 팀 리포에 커밋한 적이 있으면 바로 팀원이 됩니다.
      </p>
      <button className="btn btn-primary">합류</button>
    </form>
  );
}
