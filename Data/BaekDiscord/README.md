# DevHub (가칭 BaekDiscord)

개발자 활동 프로필(스팀식) + 팀 다이제스트(디스코드) 웹앱에, 개인 작업 도구인 **CLI 다중 제어 콘솔**과 **컴파일러**를 얹은 모노레포입니다.
설계 문서: [`docs/designs/devhub.md`](docs/designs/devhub.md) (APPROVED, 2026-09-22).

```
web/      Next.js 16 앱 — 팀 다이제스트(M1) · CLI 콘솔 · 컴파일러 UI. Vercel 배포 대상.
runner/   로컬 러너 — PTY 세션(Claude Code·Codex·셸) 관리 + 컴파일/실행. 이 PC에서만 실행.
docs/     설계 문서
```

## 빠른 시작

```bash
npm install                 # 루트에서 한 번 (workspaces: web, runner)
npm run dev:runner          # 러너: http://127.0.0.1:7331, 로그에 토큰 출력
npm run dev:web             # 웹:   http://localhost:3000
```

1. `/console` 또는 `/compile`의 **설정**에 러너 토큰을 넣고 저장합니다(브라우저 localStorage에만 저장).
2. 팀 다이제스트(`/teams`)는 GitHub OAuth가 필요합니다. `web/.env.example`을 `web/.env.local`로 복사해 채우세요.
   OAuth 없이 화면만 보려면 `DEV_LOGIN=1 npm run dev:web` 후 홈의 "개발 로그인" 링크를 누르세요(production에서는 항상 비활성).

## 기능

### 팀 다이제스트 (설계 M1)
- GitHub App 웹훅(push · pull_request) → `activity_events` 수집 → 매일 21:00 KST cron(`0 12 * * *` UTC) 한 번에 백필 → 초안 → Discord 웹훅 발행.
- 발행 후 60분 동안 **본인 행만** 편집(항목 제외 · "막힘" 메모 · "발행 안 함"). lead 예외 없음. 편집은 같은 Discord 메시지를 PATCH.
- "발행 안 함" / "기록 없음" / "미가입 @login" / "이메일 미연결 n commits"을 구분. 점수·등수·스트릭 없음. 에디터 작업시간은 팀 뷰에 절대 노출하지 않음.
- 웹훅 404/401 → `digests.status = failed` + 설정 페이지 배너. cron 누락 → "어제 다이제스트 없음" 배너 + 수동 트리거.
- DB: `DATABASE_URL`이 있으면 Neon(neon-http), 없으면 `web/.data/pglite` 로컬 PGlite. 테스트는 인메모리 PGlite.

### CLI 다중 제어 콘솔 (`/console`)
- 프리셋: Claude Code(대화형 / `claude -p` 1회), Codex(대화형 / `codex exec` 1회), PowerShell, 사용자 지정 명령.
- 세션마다 xterm.js 타일. 체크한 세션에 같은 입력을 **브로드캐스트**(Enter 포함 옵션, Ctrl+C, Esc, `y⏎`).
- **일괄 실행**: 폴더 목록을 한 줄씩 넣으면 각 폴더에 같은 프리셋/프롬프트로 세션을 동시에 띄웁니다.
- 러너가 죽지 않는 한 세션은 유지되고, 페이지를 다시 열면 최근 출력(256KB 링버퍼)을 재생합니다.

### 컴파일러 (`/compile`)
- C(gcc) · C++(g++) · Python · Java(`Main`) · JavaScript · TypeScript(Node strip-types) · Rust · Go. 설치된 툴체인만 활성화.
- stdin, 시간 제한(기본 5초, 최대 30초), 출력 64KB 캡, 예상 출력이 있으면 백준식 채점(맞았습니다/틀렸습니다/컴파일 에러/런타임 에러/시간 초과/출력 초과).
- 코드는 언어별로 브라우저 localStorage에 자동 저장.

## 러너 보안 모델
- `127.0.0.1`에만 바인딩. `Origin`이 `http://localhost:3000` / `http://127.0.0.1:3000`이 아니면 403(`RUNNER_ALLOWED_ORIGINS`로 변경).
- 모든 API·WebSocket은 토큰 필요(`RUNNER_TOKEN` 또는 자동 생성된 `runner/.runner-token`).
- 세션의 작업 폴더는 `RUNNER_CWD_ROOT`(기본: 저장소의 세 단계 위, 이 PC에서는 `D:\Projects`) 안으로 제한.
- 컴파일 실행은 임시 폴더 + 타임아웃 + 프로세스 트리 강제 종료. **샌드박스가 아니므로** 남의 코드를 돌리는 용도로는 쓰지 마세요.

## 명령

| 명령 | 설명 |
| --- | --- |
| `npm test` | 러너(21) + 웹(40) vitest |
| `npm run build` | 러너 `tsc` + 웹 `next build` |
| `npm run lint` | 웹 eslint |
| `npm run db:generate -w web` | Drizzle 마이그레이션 생성 (`web/drizzle/`) |

## 러너 HTTP/WS API (요약)

| 경로 | 설명 |
| --- | --- |
| `GET /health` | 토큰 불필요. 버전 · cwd 루트 · 세션 수 |
| `GET /languages` · `GET /presets` · `GET /sessions` | 목록 |
| `POST /compile` `{language, code, stdin?, expected?, timeoutMs?}` | 컴파일·실행·채점 |
| `POST /sessions` | 세션 생성(비대화형 클라이언트용) |
| `WS /ws?token=` | `create` · `attach` · `input{ids[]}` · `resize` · `kill{ids[]}` · `remove{ids[]}` ↔ `output` · `history` · `exit` · `sessions` |

프로토콜 타입: `runner/src/protocol.ts` (웹 쪽 `web/lib/runner/protocol.ts`는 동일 파일 사본).

## 마일스톤 상태 (2026-09-26)
- **M0 실명 팀장 확보**: 미완. 설계 문서의 The Assignment 참조. M0 없이 M1을 실사용에 넣지 않습니다.
- **M1 팀 다이제스트**: 코드 완료 · 단위/DB 테스트 통과. GitHub App · Discord 웹훅 · Vercel cron 실연동은 자격 증명 후 확인 필요.
- **콘솔 · 컴파일러**: 로컬에서 동작 검증 완료(PowerShell 2세션 브로드캐스트, C++ 채점).
