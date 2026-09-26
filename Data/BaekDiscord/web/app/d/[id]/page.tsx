import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { canViewDigest } from "@/lib/authz";
import { loadDigestView } from "@/lib/digest/pipeline";
import { editDeadline, editWindowOpen, formatDigestDateKo } from "@/lib/digest/window";
import { RowEditor } from "@/components/digest/row-editor";

export const dynamic = "force-dynamic";

export default async function DigestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/d/${id}`);
  const db = await getDb();
  const [digest] = await db.select().from(schema.digests).where(eq(schema.digests.id, id)).limit(1);
  if (!digest) notFound();
  const memberships = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, user.id));
  if (!canViewDigest(user, memberships, digest)) notFound(); // 다른 팀 → 404 (존재 자체를 숨김)

  const view = await loadDigestView(db, id);
  if (!view) notFound();
  const now = new Date();
  const open = view.digest.status === "published" && editWindowOpen(view.digest.publishedAt, now);
  const deadline = view.digest.publishedAt ? editDeadline(view.digest.publishedAt) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          📋 {view.team.name} · {formatDigestDateKo(view.digest.date)} 다이제스트
        </h1>
        <p className="text-sm text-muted">
          {view.digest.status === "published" && deadline && (
            open ? (
              <>발행 후 60분 안에 본인 행만 편집할 수 있습니다. 마감 {deadline.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })} KST.</>
            ) : (
              <>편집 창이 닫혔습니다 (발행 후 60분 경과). 디스코드 메시지는 그대로 유지됩니다.</>
            )
          )}
          {view.digest.status === "failed" && <span className="text-danger">발행 실패 — 웹훅 오류로 디스코드에 올라가지 않았습니다. 편집할 수 없습니다.</span>}
          {view.digest.status === "skipped" && <>이 날은 전원 기록 없음이라 발행되지 않았습니다.</>}
          {view.digest.status === "draft" && <>초안 상태입니다.</>}
        </p>
      </div>

      <div className="space-y-3">
        {view.members.map((m) => (
          <RowEditor
            key={m.userId}
            digestId={id}
            handle={m.handle}
            isSelf={m.userId === user.id}
            editable={open && m.userId === user.id}
            showCommitTitles={view.team.showCommitTitles}
            optedOut={m.optedOut}
            blockedNote={m.blockedNote ?? ""}
            events={m.allEvents}
          />
        ))}
      </div>

      {(view.unregistered.length > 0 || view.unlinkedCommits > 0) && (
        <div className="card p-4 text-sm">
          <h2 className="mb-2 font-medium">미확인 기여자</h2>
          <ul className="space-y-1 text-muted">
            {view.unregistered.map((u) => (
              <li key={u.login}>
                미가입: @{u.login} {u.commits} commits — 초대 링크는 팀 설정에서 만들 수 있습니다.
              </li>
            ))}
            {view.unlinkedCommits > 0 && (
              <li>
                이메일 미연결: {view.unlinkedCommits} commits — 커밋 이메일이 GitHub 계정과 연결되지 않았습니다 (<code>git config user.email</code>).
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
