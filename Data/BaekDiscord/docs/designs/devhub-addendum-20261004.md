# Addendum 2026-10-04: 관제 시스템 · 자율 판단 · 원격/모바일 · 하네스 스킬화 · 보안

기준 문서: `devhub.md` (APPROVED), `devhub-addendum-20260926.md`. 이 문서는 그 위에 얹은 변경만 적는다.

## 1. 요청과 해석

| 요청 | 구현 |
| --- | --- |
| CLI·AI 에이전트·프롬프트 AI 종합 관제 | 러너의 **슈퍼바이저**(세션 상태 판정 루프) + `/control` 대시보드 + **관제 AI** 채팅(자연어 → 도구 호출) |
| 관제·제어용 대시보드 | `/control`: 세션 보드, 집계 타일, 새 작업, 원격 접속, 이벤트 로그, 채팅. 모바일 우선 레이아웃 |
| 자아 판단 | 규칙 1차 판정 + LLM 2차 판정, 정책 3단계(수동/제안/자율), 파괴적 패턴은 항상 사람 확인 |
| 모바일/외부 원격 제어·프롬프팅 | 러너가 Next를 프록시 → 포트 하나 → ngrok/cloudflared 터널 + QR(`#rt=토큰`) + PWA |
| 수정 내용·작업 현황 시각화 | 세션별 활동 스파크라인, 작업 폴더 git 변경(파일별 +/−, 브랜치, 최근 커밋), 전체 집계 |
| 하네스 스킬화 | `runner/bin/devhubctl.mjs` + Claude Code 스킬 `D:\Projects\.claude\skills\devhub-runner` |
| 토큰 최적화 | 상태 전이 시에만 LLM 호출, 출력 해시·쿨다운, 꼬리 압축·마스킹, 프롬프트 캐시, 히스토리 절삭, 사용량 집계 |
| 보안 검증 강화 | 상수시간 토큰 비교, 실패 잠금, 레이트리밋, 입력 검증, 비밀값 마스킹, 보안 헤더/CSP, npm audit 조치, 보안 테스트 |
| 어플 제작 | **PWA**(manifest · service worker · 아이콘 · 오프라인 페이지). 네이티브(Flutter) 래퍼는 하지 않음 — 아래 4절 |

## 2. 구조

```
폰/브라우저 ──(터널 https)──▶ runner :7331 ──┬─ /runner/*  API · WS (토큰)
                                              └─ 그 외      → Next :3000 프록시 (대시보드 HTML/JS)
runner 내부: SessionManager(PTY) ← Supervisor(3초 루프) ← Brain(api | claude-cli | heuristic)
                               ← ControlChat(도구 루프)   ← TunnelManager(ngrok/cloudflared)
```

- 러너 API를 `/runner/*`로 네임스페이스했다(이전 `/health` 등은 제거). 그 외 경로는 전부 Next로 프록시한다. 그래서 터널 URL 하나로 대시보드·API·WS가 같은 출처가 되고 CORS가 사라진다.
- 웹 클라이언트는 페이지 출처가 3000 포트가 아니면 러너 URL을 `location.origin`으로 추정한다. QR 링크의 `#rt=` 토큰은 한 번 읽어 localStorage에 넣고 주소에서 지운다.

## 3. 슈퍼바이저 판단 규칙 (요약)

- 상태: `starting · working · waiting_input · idle · error · done · killed`. 출력이 8초 안에 있으면 작업 중, 프롬프트 패턴이 있고 출력이 멈추면 입력 대기, 45초 침묵이면 대기, 종료 코드로 완료/오류.
- 프롬프트 패턴: `(y/n)`류, `Press Enter`/`(esc to cancel)`, 번호 메뉴(`❯ 1. Yes`)와 Claude Code 권한 문구, 셸 프롬프트(`PS …>`), 물음표로 끝나는 짧은 줄.
- 위험 패턴: 재귀 삭제, `git push --force`/`reset --hard`/`clean -f`, DROP/TRUNCATE/DELETE, 포맷/dd, 재시작, publish/배포, 비밀값 언급, 권한 전면 개방.
- 자율 모드가 스스로 보내는 입력: 판단 엔진이 `respond`로 답하고 신뢰도 ≥0.7, 위험 신호 없음. 규칙 엔진만 있을 때는 `y/n/번호/Enter`만.
- LLM 호출 조건: 입력 대기로 **전이**했고, 대기 중인 제안이 없고, 최근 15줄 해시가 이전과 다르고, 30초 쿨다운이 지났고, 위험 신호가 없을 때.

## 4. 결정과 한계

- **앱 = PWA.** 폰에서 "홈 화면에 추가"로 독립 창 앱이 된다. 스토어 배포·푸시 알림이 필요해지면 Flutter WebView 래퍼(기존 RunClue/Familyeat 경험)를 얹는다. 지금은 알림을 디스코드 웹훅으로 대신한다.
- **터널 = ngrok/cloudflared 외부 바이너리.** 이 PC에는 ngrok이 있고 로그인돼 있다. 무료 플랜은 첫 접속 경고 페이지와 주소 변경이 있다. 고정 주소가 필요하면 ngrok 유료 도메인이나 Cloudflare 네임드 터널.
- **claude-cli 엔진 비용.** `claude -p` 한 번에 Claude Code 시스템 프롬프트가 붙어 3~4만 토큰(대부분 캐시 읽기, 실측 2회 호출 76.7k 입력)이다. 판단은 전이 시에만 하므로 하루 수십 번 수준이면 감당되지만, 상시 사용은 `ANTHROPIC_API_KEY`+`api` 엔진이 맞다.
- **메모리.** 이 PC는 메모리가 부족해 백그라운드 프로세스가 강제 종료된 적이 있다. 러너 세션 상한은 12이지만 Claude Code 대화형 세션은 3~4개 이내를 권한다.
- **모바일 폭 실기 검증 미완.** 360~400px 레이아웃은 코드상 반응형이지만 브라우저 확장의 창 크기 변경이 캡처에 반영되지 않아 실제 폰에서 확인해야 한다.
- **npm audit.** 프로덕션 의존성(drizzle-orm SQL 인젝션)은 0.45.3으로 올려 해결. 남은 11건은 전부 devDependencies(eslint-config-next의 fast-glob/braces 체인, drizzle-kit의 esbuild-kit, vitest mocker)이며 vitest는 5로 올렸다. eslint-config-next·drizzle-kit 체인은 메이저 다운그레이드를 요구하는 가짜 수정이라 두었다. 런타임 노출 없음.

## 5. 검증

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| 러너 단위/통합 | vitest 50 (compiler 12 · server 9 · security 8 · heuristics 12 · supervisor+chat 9) | 통과 |
| 웹 | vitest 40, `tsc`, eslint(0 경고) | 통과 |
| 슈퍼바이저 왕복 | devhubctl로 `(y/n)` 세션 생성 → 입력 대기 판정·제안 → 입력 → 완료, 이벤트 로그 | 통과 |
| 대시보드 | 프록시 경로 `127.0.0.1:7331/control#rt=`로 자동 인증, Enter 제안 승인 → 세션 완료, 작업 현황(스파크라인·git) | 통과 |
| 원격 | ngrok 터널 시작 → 공개 URL·QR 표시 → 외부 curl: health 200, 토큰 없음 401, 토큰 200, 대시보드 200 → 터널 닫기 | 통과 |
| 관제 AI | `claude-cli` 엔진으로 "세션 목록 요약" → list_sessions 도구 → 요약 응답 12.9초 | 통과 |
| 보안 | 잘못된 토큰 401, 허용되지 않은 Origin 403, 루트 밖 cwd 거부, 파괴적 입력 거부(확인 시 허용), 비밀값 마스킹 | 테스트로 고정 |

## 6. 다음 할 일
1. 실제 폰에서 PWA 설치·터널 접속·터미널 타일 조작 확인.
2. API 키를 넣어 `api` 엔진으로 전환, 판단 품질·토큰 비교.
3. 세션 생성 시 타일 실제 크기로 PTY 생성, Claude Code 대화형 세션의 특수키 처리.
4. M0(실명 팀장) — 변함없음.
