import { requireUser } from "@/lib/auth/session";
import { NewTeamForm } from "@/components/teams/new-team-form";

export const dynamic = "force-dynamic";

export default async function NewTeamPage() {
  await requireUser("/teams/new");
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">팀 만들기</h1>
        <p className="text-sm text-muted">
          디스코드 채널 설정 → 연동 → 웹훅에서 URL을 만들어 붙여넣으세요. 저장 전에 테스트 메시지를 보내 확인합니다.
        </p>
      </div>
      <NewTeamForm />
    </div>
  );
}
