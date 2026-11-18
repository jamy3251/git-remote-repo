import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "DevHub 소개",
  description: "여러 AI 코딩 에이전트를 PC에서 돌려 두고, 누가 답을 기다리는지 한 화면과 폰, 메신저로 받아 보는 관제 도구",
};

const problems = [
  { title: "어느 창이 멈췄는지 모릅니다", body: "에이전트를 서너 개 띄우면 그중 하나는 권한 확인에서 멈춰 있습니다. 창을 하나씩 넘겨 봐야 알 수 있습니다." },
  { title: "자리를 비우면 그대로 섭니다", body: "y 한 번이면 될 일이 사람을 기다리며 한 시간씩 지나갑니다. 돌아와서야 압니다." },
  { title: "같은 폴더를 둘이 고칩니다", body: "세션 두 개가 같은 파일을 건드리면 변경이 섞입니다. 누가 무엇을 바꿨는지 가리기 어렵습니다." },
];

const features = [
  {
    title: "한 화면 관제",
    body: "작업 중, 입력 대기, 오류, 완료를 세션마다 보여 줍니다. Claude Code는 hook으로 상태를 받아 '확정'으로, 나머지는 출력으로 읽어 '추정'으로 표시합니다.",
  },
  {
    title: "폰에서 답하기",
    body: "터널을 열고 QR을 찍으면 폰에서 같은 화면이 열립니다. 승인, 번호 선택, Esc를 버튼으로 보내고 터미널도 그대로 봅니다.",
  },
  {
    title: "메신저로 진행 알림",
    body: "세션이 시작될 때, 답을 기다릴 때, 끝났을 때 카카오톡(나에게 보내기), 텔레그램, 디스코드로 알려 줍니다. 실행 중에는 정해 둔 간격으로 진행 상황을 묶어 보냅니다.",
  },
  {
    title: "슈퍼바이저 제안",
    body: "멈춘 화면을 읽고 보낼 답을 제안합니다. 정책을 자율로 두면 안전한 답은 직접 보냅니다. 삭제나 강제 푸시 같은 위험한 명령은 항상 사람에게 올립니다.",
  },
  {
    title: "같은 폴더 경고",
    body: "실행 중인 세션과 같은 폴더, 상위 폴더, 하위 폴더에서 새 세션을 시작하려 하면 먼저 알려 주고 기존 세션을 열지 물어봅니다.",
  },
  {
    title: "작업 내역과 교차검증",
    body: "끝난 세션마다 바뀐 파일과 줄 수, 요약을 남깁니다. 원하면 다른 AI가 읽기 전용으로 결과를 검토하고 통과 여부를 돌려줍니다.",
  },
];

const messages = [
  { time: "14:02", lines: ["[DevHub] 시작: 결제 모듈 테스트 보강 (claude)", "폴더: shop-api", "목표: 환불 경로 테스트 추가"] },
  { time: "14:19", lines: ["[DevHub] 로그인 화면 리팩터링 (claude)", "입력 대기: 파일 3개를 바꾸는 확인 질문"] },
  { time: "14:30", lines: ["[DevHub] 진행 상황 14:30", "작업 중 2 · 입력 대기 1", "- 로그인 화면 리팩터링: 입력 대기, 권한 확인 필요 (28분째)", "- 결제 모듈 테스트 보강: 작업 중 (28분째)"] },
  { time: "14:41", lines: ["[DevHub] 완료: 결제 모듈 테스트 보강", "39분 · 파일 4개 (+212 −18)", "환불 경로 테스트 6개 추가, 전체 통과."] },
];

const steps = [
  { n: "1", title: "PC에서 러너를 켭니다", body: "러너가 Claude Code, Codex, 셸 세션을 띄우고 화면을 읽습니다. 코드는 PC 밖으로 나가지 않습니다." },
  { n: "2", title: "관제 화면에서 지시합니다", body: "폴더를 고르고 할 일을 적으면 에이전트가 시작됩니다. 여러 개를 동시에 돌려도 한 화면에 모입니다." },
  { n: "3", title: "자리를 떠도 소식이 옵니다", body: "답이 필요하면 메신저로 알림이 오고, 폰에서 열어 답합니다. 끝나면 무엇이 바뀌었는지 함께 옵니다." },
];

const safety = [
  "러너는 내 PC의 127.0.0.1에서만 받습니다. 원격은 내가 연 터널로만 들어오고, 쓰지 않으면 자동으로 닫힙니다.",
  "접속에는 토큰이 필요하고, 틀린 시도가 반복되면 잠깁니다.",
  "API 키처럼 생긴 문자열은 알림과 판단 엔진으로 나가기 전에 가립니다.",
  "메신저로 가는 내용은 세션 이름, 상태, 바뀐 파일 수, 짧은 요약입니다. 코드 본문은 보내지 않습니다.",
];

const limits = [
  "혼자 쓰는 개발자를 위한 도구입니다. 팀 계정이나 권한 관리는 없습니다.",
  "Windows에서 만들고 시험했습니다. macOS와 Linux는 아직 확인하지 못했습니다.",
  "카카오톡은 '나에게 보내기'라서 내 채팅방에 쌓입니다. 소리 알림이 꼭 필요하면 텔레그램을 같이 켜 두기를 권합니다.",
];

export default function Intro() {
  return (
    <div className="mx-auto max-w-5xl">
      <section className="pt-6 pb-12 sm:pt-12">
        <p className="mb-3 text-sm text-muted">AI 코딩 에이전트 관제 도구</p>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">에이전트 여러 개를 돌려 두고, 답이 필요한 순간만 받아 보세요.</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
          DevHub는 PC에서 도는 Claude Code와 Codex 세션을 한 화면에 모읍니다. 어느 세션이 멈췄는지 보여 주고, 폰에서 답하게 하고, 시작과 완료를 메신저로 알려 줍니다.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <a href="#start" className="btn btn-primary px-4 py-2">
            시작하는 방법
          </a>
          <Link href="/control" className="btn px-4 py-2">
            관제 열기
          </Link>
        </div>
        <figure className="mt-10">
          <div className="overflow-hidden rounded-lg border border-border">
            <Image src="/promo/control.jpg" width={760} height={744} alt="관제 화면: 세션 집계, 새 작업 입력, 입력 대기 세션의 승인 버튼, 작업 내역" priority className="h-auto w-full" />
          </div>
          <figcaption className="mt-2 text-xs text-muted">데모 모드(npm run demo)의 실제 관제 화면입니다. 세션은 가짜지만 화면은 그대로입니다.</figcaption>
        </figure>
      </section>

      <section className="border-t border-border py-12">
        <h2 className="text-xl font-semibold">에이전트가 늘면 생기는 일</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {problems.map((p) => (
            <div key={p.title}>
              <h3 className="font-medium">{p.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-12">
        <h2 className="text-xl font-semibold">DevHub가 하는 일</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card p-4">
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-12">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">메신저에는 이렇게 옵니다</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              관제 화면을 열어 두지 않아도 됩니다. 세션이 시작될 때, 사람의 답을 기다릴 때, 끝났을 때 한 번씩 옵니다. 실행 중인 세션이 있으면 30분마다 진행 상황을 묶어 보내고, 간격은 바꾸거나 끌 수 있습니다.
            </p>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">카카오톡</dt>
                <dd>나에게 보내기. 한 번 로그인하면 내 채팅방으로 옵니다.</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">텔레그램</dt>
                <dd>내 봇이 내 대화방으로 보냅니다. 소리 알림이 옵니다.</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">디스코드</dt>
                <dd>웹훅 주소 하나로 채널에 올립니다.</dd>
              </div>
            </dl>
            <p className="mt-5 text-xs text-muted">
              설정은 환경 변수 몇 개입니다. 저장소의 <code className="font-mono text-foreground">docs/notify.md</code>에 채널별 순서가 있습니다.
            </p>
          </div>
          <div className="card p-4">
            <p className="mb-3 text-xs text-muted">알림 예시 (실제로 보내는 형식)</p>
            <ol className="space-y-3">
              {messages.map((m) => (
                <li key={m.time} className="flex items-end gap-2">
                  <div className="rounded-lg rounded-bl-sm bg-surface-2 px-3 py-2 text-sm leading-6">
                    {m.lines.map((l, i) => (
                      <p key={l} className={i === 0 ? "font-medium" : "text-muted"}>
                        {l}
                      </p>
                    ))}
                  </div>
                  <time className="shrink-0 pb-1 text-[11px] text-muted">{m.time}</time>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-t border-border py-12">
        <h2 className="text-xl font-semibold">쓰는 순서</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <p className="font-mono text-sm text-accent">{s.n}</p>
              <h3 className="mt-1 font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border py-12">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold">내 PC 밖으로 나가는 것</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
              {safety.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-xl font-semibold">아직 안 되는 것</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
              {limits.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="start" className="scroll-mt-6 border-t border-border py-12">
        <h2 className="text-xl font-semibold">시작하는 방법</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="card p-4">
            <h3 className="font-medium">먼저 구경하기</h3>
            <p className="mt-2 text-sm leading-6 text-muted">Claude Code도 토큰도 필요 없습니다. 가짜 세션으로 관제 화면이 열립니다.</p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">npm install{"\n"}npm run demo</pre>
          </div>
          <div className="card p-4">
            <h3 className="font-medium">실제로 쓰기</h3>
            <p className="mt-2 text-sm leading-6 text-muted">러너와 웹을 함께 띄웁니다. 러너 로그에 나오는 대시보드 링크로 들어가면 됩니다.</p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">npm run dev{"\n"}devhubctl notify test</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
