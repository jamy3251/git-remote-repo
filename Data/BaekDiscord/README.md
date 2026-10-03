# DevHub (가칭 BaekDiscord)

개발자 활동 프로필(스팀식) + 팀 다이제스트(디스코드) 웹앱에, 개인 작업 도구인 **CLI 다중 제어 콘솔**, **컴파일러**, 그리고 CLI·AI 에이전트를 지켜보고 스스로 판단하는 **관제 시스템**을 얹은 모노레포입니다. 휴대폰에서도 터널+QR로 같은 대시보드를 씁니다.

설계 문서: [`docs/designs/devhub.md`](docs/designs/devhub.md) (APPROVED, 2026-09-22), 구현 변경·추가 기능: [`docs/designs/devhub-addendum-20260926.md`](docs/designs/devhub-addendum-20260926.md), [`devhub-addendum-20261004.md`](docs/designs/devhub-addendum-20261004.md).

```
web/      Next.js 16 앱 — 팀 다이제스트(M1) · 관제(/control) · CLI 콘솔 · 컴파일러. PWA.
runner/   로컬 러너 — PTY 세션 관리, 슈퍼바이저(자율 판단), 관제 AI, 컴파일, 터널, 웹 프록시.
runner/bin/devhubctl.mjs   러너 제어 CLI (Claude Code 스킬 `devhub-runner`가 사용)
docs/     설계 문서
```

## 빠른 시작

```bash
npm install                 # 루트에서 한 번 (workspaces: web, runner)
npm run dev:runner          # 러너: http://127.0.0.1:7331, 로그에 토큰과 대시보드 링크 출력
npm run dev:web             # 웹:   http://localhost:3000 (러너가 7331로 프록시도 해줌)
```

러너 로그의 `dashboard: http://127.0.0.1:7331/control#rt=<토큰>` 링크를 열면 토큰이 자동 저장됩니다. 3000 포트로 직접 열 때는 `/control`이나 `/console`의 **설정**에 토큰을 넣으세요.

팀 다이제스트(`/teams`)는 GitHub OAuth가 필요합니다. `web/.env.example` → `web/.env.local`. OAuth 없이 화면만 보려면 `DEV_LOGIN=1 npm run dev:web`.

## 기능

### 관제 (`/control`) — CLI·AI 에이전트 종합 관제
- **세션 보드**: 세션마다 상태(시작 중 · 작업 중 · 입력 대기 · 대기 · 오류 · 완료 · 종료됨), 마지막 출력 줄, 경과 시간, 목표, 정책, 슈퍼바이저 제안(승인/무시), 빠른 입력(y⏎ · ⏎ · Ctrl+C · Esc), 터미널 펼치기.
- **작업 현황 시각화**: 세션별 출력 활동 스파크라인(30초 단위 30분), 작업 폴더의 git 브랜치·ahead/behind·변경 파일(+/−)·최근 커밋. 상단 타일에 실행 중/입력 대기/오류/완료 집계와 전체 활동 그래프.
- **새 작업**: 프롬프트 + 폴더 + 목표 + 정책만 적으면 `claude -p` 세션이 뜹니다. 폰에서 지시를 보내는 기본 경로.
- **관제 AI 채팅**: "RunClue 폴더에서 테스트 돌려줘" 같은 자연어를 도구 호출(세션 목록·출력 읽기·입력·생성·종료·목표/정책·제안 승인·폴더 탐색)로 바꿔 실행하고 결과를 요약합니다.
- **이벤트 로그**: 슈퍼바이저 판단, 사람의 조작, 관제 AI의 행동을 누가(actor) 언제 했는지 모두 남깁니다(감사 로그).
- **원격 접속**: ngrok 또는 cloudflared 터널을 한 버튼으로 열고 QR을 띄웁니다. 폰에서 QR을 찍으면 토큰이 들어간 링크로 바로 접속됩니다.

### 슈퍼바이저 (자율 판단)
- 3초마다 각 세션의 최근 출력을 규칙으로 1차 판정합니다: 예/아니오 질문, Enter 대기, 선택 메뉴(Claude Code 권한 프롬프트 포함), 셸 프롬프트, 오류, 침묵.
- 정책 세 단계: **수동**(관찰·알림만) · **제안**(판단 엔진이 응답을 제안, 사람이 승인) · **자율**(안전한 입력은 스스로 전송, 나머지는 사람에게).
- **안전 규칙**: 삭제·force push·배포·비밀값·시스템 변경이 출력에 보이면 정책과 무관하게 항상 사람 확인으로 올립니다. 자율 모드가 스스로 보내는 입력은 `y`/`n`/번호/Enter 같은 단순 응답뿐이며 신뢰도 0.7 이상일 때만입니다.
- **판단 엔진** (`SUPERVISOR_BRAIN`): `api`(Anthropic API, `ANTHROPIC_API_KEY`) → `claude-cli`(설치된 Claude Code의 `claude -p`, 키 불필요) → `heuristic`(규칙만). 기본 `auto`는 이 순서로 고릅니다.
- **알림**: `SUPERVISOR_NOTIFY_WEBHOOK`(디스코드 웹훅)에 입력 대기·확인 요청을 보냅니다(세션당 60초 디바운스, 비밀값 마스킹).

### 토큰 최적화
- 판단 엔진은 상태가 **입력 대기로 바뀔 때만** 호출합니다. 같은 출력(해시)에는 다시 묻지 않고, 세션당 30초 쿨다운이 있습니다. 위험 신호가 있으면 LLM을 부르지 않고 바로 사람에게 올립니다.
- 출력 꼬리는 반복 줄 압축·박스 문자 제거·2.4KB 상한·비밀값 마스킹 후 보냅니다. 채팅 히스토리는 최근 12턴만, 이전 도구 결과는 한 줄로 접습니다.
- API 엔진은 시스템 프롬프트에 프롬프트 캐시를 겁니다. 호출 수·입출력 토큰은 대시보드 상단과 `/runner/supervisor`에서 보입니다.
- `claude-cli` 엔진은 호출마다 Claude Code 자체 시스템 프롬프트(약 3~4만 토큰, 대부분 캐시 읽기)가 붙습니다. 자주 쓰면 API 키를 넣고 `api` 엔진을 쓰는 편이 훨씬 쌉니다. 모델은 `SUPERVISOR_MODEL`로 바꿉니다(기본 `claude-opus-5`).

### CLI 다중 제어 콘솔 (`/console`)
- 프리셋: Claude Code(대화형 / `claude -p` 1회), Codex(대화형 / `codex exec` 1회), PowerShell, 사용자 지정 명령. 세션마다 xterm.js 타일, 선택 세션에 입력 브로드캐스트, 여러 폴더 일괄 실행.

### 컴파일러 (`/compile`)
- C(gcc) · C++(g++) · Python · Java(`Main`) · JavaScript · TypeScript · Rust · Go. stdin·시간 제한·출력 캡, 예상 출력이 있으면 백준식 채점.

### 팀 다이제스트 (설계 M1, `/teams`)
- GitHub App 웹훅 → 매일 21:00 KST Discord 발행, 발행 후 60분 본인 행만 편집, 점수·등수 없음. 자세한 내용은 설계 문서.

## 모바일 / 원격 (앱)
1. 대시보드 **원격 접속 → ngrok 열기** (또는 `RUNNER_TUNNEL=1 npm run dev:runner`).
2. 폰으로 QR을 찍습니다. 링크의 `#rt=` 토큰이 폰에 저장되고 주소창에서 지워집니다. ngrok 무료 플랜은 첫 접속에 경고 페이지가 뜨니 Visit Site를 누릅니다.
3. 폰 브라우저 메뉴에서 **홈 화면에 추가**: 독립 창으로 뜨는 PWA 앱(`DevHub 관제`)이 됩니다. 오프라인이면 안내 페이지가 뜨고, `/runner/*`는 절대 캐시하지 않습니다.
4. 끝나면 **터널 닫기**. 터널 주소는 매번 바뀌며, 토큰이 유출됐다고 생각되면 `runner/.runner-token`을 지우고 러너를 재시작하세요.

Claude Code에서 이 러너를 쓰려면 `/devhub-runner` 스킬(`D:\Projects\.claude\skills\devhub-runner`)이 `devhubctl` 사용법을 제공합니다.

## 러너 환경 변수

| 변수 | 기본 | 설명 |
| --- | --- | --- |
| `RUNNER_TOKEN` | 자동 생성(`runner/.runner-token`) | 모든 API·WS 인증 토큰 |
| `RUNNER_PORT` / `RUNNER_HOST` | 7331 / 127.0.0.1 | 바인딩. 외부 노출은 터널로만 |
| `RUNNER_CWD_ROOT` | 저장소 세 단계 위(`D:\Projects`) | 세션 작업 폴더 상한 |
| `RUNNER_WEB_PROXY` | `http://127.0.0.1:3000` | `/runner` 밖 경로를 넘길 Next 서버(`off`로 비활성) |
| `RUNNER_ALLOWED_ORIGINS` | localhost:3000 · 127.0.0.1:3000 · :7331 | 브라우저 Origin 화이트리스트(터널 URL은 자동 추가) |
| `RUNNER_TUNNEL` | – | `1`이면 시작 시 터널 자동 열기 |
| `SUPERVISOR_ENABLED` | 1 | `0`이면 관찰 루프 정지 |
| `SUPERVISOR_DEFAULT_POLICY` | assist | manual · assist · auto |
| `SUPERVISOR_BRAIN` | auto | api · claude-cli · heuristic |
| `SUPERVISOR_MODEL` | claude-opus-5 (api) | 판단 모델 |
| `ANTHROPIC_API_KEY` | – | api 엔진 |
| `SUPERVISOR_NOTIFY_WEBHOOK` | – | 디스코드 웹훅 URL |
| `SUPERVISOR_INTERVAL_MS` | 3000 | 관찰 주기 |

## 보안 모델
- 러너는 127.0.0.1에만 바인딩하고, 브라우저 Origin 화이트리스트와 Bearer 토큰(상수시간 비교)을 요구합니다. `/runner/health`만 공개.
- 인증 실패 5회(10분)면 그 클라이언트는 15분 잠금(HTTP·WS 공통). 전체 요청 240/분, 컴파일 20/분 제한. WS 메시지 256KB, 입력 16KB, 코드 200KB 상한.
- 세션 cwd·관제 AI의 폴더 탐색은 `RUNNER_CWD_ROOT` 안으로 제한. 세션 id 등은 형식 검증.
- 관제 AI와 자율 모드는 파괴적 패턴(rm -rf, force push, DROP, 배포, 비밀값…)을 거부하거나 사람에게 올립니다. 채팅에서 "확인"을 명시하거나 `--confirm`일 때만 통과.
- 밖으로 나가는 텍스트(판단 엔진 프롬프트, 알림)는 토큰·키·비밀번호 형태를 `[REDACTED]`로 마스킹.
- 응답 헤더: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`. 웹은 CSP·보안 헤더를 `next.config.ts`에서 적용.
- 샌드박스는 아닙니다. 자기 PC·자기 코드 전용이며, 터널은 쓸 때만 열고 닫으세요.

## 명령

| 명령 | 설명 |
| --- | --- |
| `npm test` | 러너(50) + 웹(40) vitest |
| `npm run build` | 러너 `tsc` + 웹 `next build` |
| `npm run lint` | 웹 eslint |
| `npm run ctl -w runner -- sessions` | devhubctl (health · sessions · create · send · output · kill · workspace · events · chat · tunnel) |
| `npm run db:generate -w web` | Drizzle 마이그레이션 생성 |

## 러너 API (요약, 모두 `/runner` 아래)

| 경로 | 설명 |
| --- | --- |
| `GET /health` | 토큰 불필요. 버전 · cwd 루트 · 세션 수 · 터널/슈퍼바이저 상태 |
| `GET /sessions` · `POST /sessions` | 목록 · 생성(`preset, cwd, prompt, goal, policy, command`) |
| `POST /sessions/:id/input {data}` · `POST /sessions/:id/kill` | 입력 · 종료 |
| `GET /sessions/:id/output?lines=` · `GET /sessions/:id/workspace` | 출력 꼬리 · git 현황+활동 |
| `GET /events` · `GET /supervisor` · `GET /tunnel` | 이벤트 · 슈퍼바이저 설정/토큰 · 터널 상태 |
| `POST /chat {text, confirm?}` | 관제 AI |
| `POST /compile` | 컴파일·실행·채점 |
| `WS /ws?token=` | 위 전부 + `set_goal` · `set_policy` · `suggestion` · `supervisor` · `tunnel` · `workspace` 실시간 |

프로토콜 타입: `runner/src/protocol.ts` (`web/lib/runner/protocol.ts`는 동일 사본).

## 마일스톤 상태 (2026-10-04)
- **M0 실명 팀장 확보**: 미완. M0 없이 M1을 실사용에 넣지 않습니다.
- **M1 팀 다이제스트**: 코드 완료 · 테스트 통과. GitHub App · Discord 웹훅 · Vercel cron 실연동은 자격 증명 후.
- **콘솔 · 컴파일러 · 관제 · 원격**: 로컬에서 동작 검증(브라우저 + devhubctl + ngrok 터널 왕복).
