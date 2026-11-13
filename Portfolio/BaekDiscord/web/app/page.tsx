import Link from "next/link";

const areas = [
  {
    href: "/control",
    title: "관제",
    body: "모든 에이전트 세션의 상태를 한눈에 보고, 슈퍼바이저가 입력 대기·오류를 판단해 제안하거나 자율 응답합니다. 터널+QR로 휴대폰에서도 지시합니다.",
    status: "모바일/원격",
  },
  {
    href: "/teams",
    title: "팀 다이제스트 (M1)",
    body: "GitHub 커밋·PR을 자동 수집해 매일 21:00 팀 디스코드 채널에 발행합니다. 점수·등수 없음, 발행 후 60분 본인 행 편집.",
    status: "설계 승인 · 구현 중",
  },
  {
    href: "/console",
    title: "CLI 다중 제어 콘솔",
    body: "Claude Code · Codex · 셸 세션을 여러 개 띄워 한 화면에서 보고, 선택한 세션에 같은 입력을 브로드캐스트합니다. 여러 폴더 일괄 실행 지원.",
    status: "로컬 러너 필요",
  },
  {
    href: "/compile",
    title: "컴파일러",
    body: "C · C++ · Python · Java · JS · TS를 로컬 툴체인으로 컴파일·실행하고, 예상 출력이 있으면 백준식으로 채점합니다.",
    status: "로컬 러너 필요",
  },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ setup?: string; next?: string }> }) {
  const { setup, next } = await searchParams;
  const devLogin = process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "1";
  return (
    <div>
      {setup === "github-oauth" && (
        <div className="card mb-6 border-warn/40 p-4 text-sm">
          <p className="font-medium text-warn">GitHub 로그인이 아직 설정되지 않았습니다.</p>
          <p className="mt-1 text-muted">
            팀 다이제스트 페이지는 GitHub OAuth 로그인이 필요합니다. <code className="font-mono text-foreground">web/.env.local</code>에{" "}
            <code className="font-mono text-foreground">GITHUB_CLIENT_ID</code> / <code className="font-mono text-foreground">GITHUB_CLIENT_SECRET</code>을 넣고 개발 서버를 다시 시작하세요.
            {devLogin ? (
              <>
                {" "}
                로컬 확인용으로는{" "}
                <Link className="text-accent underline" href={`/api/auth/dev?next=${encodeURIComponent(next ?? "/teams")}`}>
                  개발 로그인
                </Link>
                을 쓸 수 있습니다.
              </>
            ) : (
              <>
                {" "}
                OAuth 없이 화면만 보려면 <code className="font-mono text-foreground">DEV_LOGIN=1</code>로 개발 서버를 띄우면 개발 로그인 링크가 여기 나타납니다.
              </>
            )}
          </p>
        </div>
      )}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">DevHub</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          개발 활동은 이미 GitHub와 에디터에 있습니다. 사람이 손으로 옮기지 않아도 팀이 보게 하는 것이 이 프로젝트의 본질이고, 콘솔과 컴파일러는 그 위에 얹은 개인 작업 도구입니다.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {areas.map((a) => (
          <Link key={a.href} href={a.href} className="card block p-4 transition hover:border-accent">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-medium">{a.title}</h2>
              <span className="badge">{a.status}</span>
            </div>
            <p className="text-sm text-muted">{a.body}</p>
          </Link>
        ))}
      </div>
      <div className="card mt-6 p-4 text-sm">
        <h3 className="mb-2 font-medium">로컬에서 시작하기</h3>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>
            저장소 루트에서 <code className="font-mono text-foreground">npm run dev:runner</code> 실행 → 로그에 찍힌 토큰을 복사
          </li>
          <li>
            <code className="font-mono text-foreground">npm run dev:web</code> 실행 후 콘솔 또는 컴파일러 페이지의 &quot;설정&quot;에 토큰 입력
          </li>
          <li>
            팀 다이제스트는 <code className="font-mono text-foreground">web/.env.example</code>의 GitHub OAuth · GitHub App · CRON_SECRET 설정이 필요합니다
          </li>
        </ol>
      </div>
    </div>
  );
}
