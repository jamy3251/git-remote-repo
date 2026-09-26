import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await requireUser("/teams");
  const db = await getDb();
  const rows = await db
    .select({ id: schema.teams.id, name: schema.teams.name, role: schema.teamMembers.role, status: schema.teamMembers.status, webhookInvalid: schema.teams.webhookInvalid })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(eq(schema.teamMembers.userId, user.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">팀 다이제스트</h1>
          <p className="text-sm text-muted">매일 21:00 KST, 팀 디스코드 채널에 자동으로 올라갑니다. 점수·등수 없음.</p>
        </div>
        <Link href="/teams/new" className="btn btn-primary">
          팀 만들기
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          아직 속한 팀이 없습니다. 팀장이라면 팀을 만들고, 팀원이라면 팀장에게 초대 링크를 받으세요.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((t) => (
            <li key={t.id} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                <span className="badge">{t.role === "lead" ? "팀장" : t.status === "pending" ? "승인 대기" : "팀원"}</span>
              </div>
              {t.webhookInvalid && <p className="mt-2 text-xs text-danger">웹훅 무효 — 설정에서 URL을 다시 입력하세요.</p>}
              <div className="mt-3 flex gap-2 text-sm">
                <Link href={`/teams/${t.id}/settings`} className="btn">
                  설정
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        로그인: {user.handle} ·{" "}
        <a href="/api/auth/logout" className="underline">
          로그아웃
        </a>
      </p>
    </div>
  );
}
