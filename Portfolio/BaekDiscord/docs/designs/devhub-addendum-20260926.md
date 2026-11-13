# Addendum 2026-09-26: 구현 착수 + CLI 다중 제어 콘솔 + 컴파일러

기준 문서: `devhub.md` (APPROVED 2026-09-22). 이 문서는 그 위에 얹은 변경만 적는다.

## 1. 구현 상태

| 영역 | 상태 | 검증 |
| --- | --- | --- |
| M1 팀 다이제스트 (`web/`) | 코드 완료 | vitest 40 (render 9 · window 7 · webhook 7 · authz 8 · db 9), `tsc`, eslint 통과. GitHub App·Discord·Vercel cron 실연동은 자격 증명 후. |
| 로컬 러너 (`runner/`) | 코드 완료 | vitest 21 (compiler 12 · server 9). Windows ConPTY(node-pty 프리빌드) 동작. |
| CLI 콘솔 (`/console`) | 동작 확인 | 브라우저에서 PowerShell 2세션 생성 → 브로드캐스트 `echo` 양쪽 반영 → 선택 종료. |
| 컴파일러 (`/compile`) | 동작 확인 | 브라우저에서 C++ `1 2` → `3` 채점 "맞았습니다!!". |

M0(실명 팀장)은 여전히 미완이다. **M1 코드는 존재하지만 실사용 투입은 M0 이후**라는 게이트는 유지한다.

## 2. 설계 대비 변경

- **테이블 2개 컬럼 추가**: `teams.webhook_invalid`(설정 페이지 배너용), `team_members.status[active|pending]`(초대 링크 합류 흐름). `invites(token, team_id, expires_at)` 테이블 추가. 점수·랭킹·스트릭 컬럼은 여전히 없다.
- **인증**: Auth.js 대신 GitHub OAuth를 직접 구현(jose HS256 쿠키 세션). Next.js 16 peer 의존성 문제를 피하고 코드가 100줄 안팎이라 단순함을 택했다.
- **DB 로컬 개발**: `DATABASE_URL` 없으면 PGlite 파일 DB(`web/.data/pglite`). Neon 없이도 M1 화면·테스트가 돈다.
- **개발 로그인**: `DEV_LOGIN=1`일 때만 `/api/auth/dev?login=<handle>`로 가짜 계정 로그인. production에서는 404. OAuth 미설정 상태로 `/teams` 접근 시 GitHub로 튕기지 않고 홈에 설정 안내 배너를 띄운다.
- **수동 재트리거**는 같은 날짜의 digest 행을 교체한다(이전 Discord 메시지는 남음).

## 3. 새 기능: CLI 다중 제어 콘솔 + 컴파일러 (설계 문서 범위 밖)

원래 설계의 "개인 프로필 층"과 별개로, 창업자 본인이 매일 쓰는 **개인 작업 도구**로 추가했다. 팀 다이제스트의 원칙(감시 금지, 점수 없음)과 충돌하지 않는다. 이 둘은 서버(Vercel)가 아니라 **로컬 러너**가 실행한다.

### 구조
```
브라우저(/console, /compile)  ──WS/HTTP──▶  runner (127.0.0.1:7331, 토큰)  ──▶  node-pty / child_process
```
- Vercel 서버리스는 장수 프로세스·gcc를 가질 수 없으므로 러너는 항상 사용자의 PC에서 돈다. 웹은 순수 클라이언트로 러너에 붙는다(러너 URL·토큰은 localStorage).
- 러너 보안: 127.0.0.1 바인딩, `Origin` 화이트리스트(localhost:3000), 토큰 필수, 세션 cwd는 `RUNNER_CWD_ROOT` 안으로 제한, 동시 컴파일 2개, 출력 64KB 캡, 타임아웃 시 프로세스 트리 강제 종료. 샌드박스는 아니다(자기 코드 전용).

### 콘솔
- 프리셋: `claude`(PTY 대화형), `claude-print`(`claude -p`, 프롬프트를 stdin으로), `codex`, `codex-exec`(`codex exec -`), `shell`, `custom`.
- 세션당 xterm.js 타일, 체크한 세션에 입력 브로드캐스트, 일괄 실행(폴더 목록 → 각 폴더에 같은 프리셋/프롬프트), 세션 출력 링버퍼(256KB)로 재접속 시 재생.
- Windows에서 node-pty는 인자 배열을 재인용해 `cmd /c "..."`를 깨뜨리므로 PTY 경로는 명령줄 문자열을 그대로 넘긴다(`runner/src/sessions.ts` `shellWrap`).

### 컴파일러
- 언어 정의 테이블(`runner/src/compiler/languages.ts`): C·C++·Python·Java(`Main`)·JS·TS(strip-types)·Rust·Go. 시작 시 툴체인 존재를 프로브해 미설치는 비활성.
- `POST /compile {language, code, stdin, expected?, timeoutMs?}` → 컴파일 단계·실행 단계 결과 + 백준식 verdict(줄 끝 공백·마지막 개행 무시).

## 4. 다음 할 일
1. **M0**: 실명 팀장 1명 확보(변함없음).
2. 자격 증명 넣고 실연동: GitHub App(웹훅 서명·설치 콜백), Discord 웹훅 테스트 메시지·PATCH, Vercel cron.
3. 콘솔: 세션 생성 시 타일 실제 크기로 PTY 생성(현재 100x30 → fit), Claude Code 대화형 세션의 키 입력(방향키·붙여넣기) 실사용 점검.
4. 컴파일러: 여러 테스트케이스 일괄 채점, 백준 문제 번호로 예제 입출력 가져오기(v1.1 `solvedac` 플러그인과 묶기).
