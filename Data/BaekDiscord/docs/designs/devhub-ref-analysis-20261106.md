# 데스크톱 메신저·협업 앱 분석과 DevHub 응용 (2026-11-06)

Discord, Slack, Notion, Figma의 **배포된 데스크톱 앱 번들**을 REA(reverse-engineering MCP)로 정적 분석하고, 그중 DevHub 관제(/control)에 맞는 패턴을 골라 적용했다. 이 문서는 (1) 무엇을 어떤 증거로 봤는지, (2) DevHub에 무엇을 어떻게 옮겼는지, (3) 보류한 것을 기록한다.

> 정적 분석 결과다. 번들 코드는 실행하지 않았고, 아래 "관찰"은 코드에 그렇게 쓰여 있다는 뜻이지 런타임에서 그렇게 동작함을 증명한 것은 아니다. REA 한계 문구(동적 호출 미해석, 커버리지 partial)는 각 Evidence 기록에 남아 있다.

## 1. 분석 대상과 증거

| 앱 | 버전 | 입력 | REA 결과 (parent evidence) | 비고 |
| --- | --- | --- | --- | --- |
| Discord | 1.0.9267 (설치본) | `modules/discord_desktop_core-1/discord_desktop_core/core.asar` (sha256 `acde9b22…e4257`) | `ev_92e5c09e…a0f7b` — 모듈 503, 파싱 3파일, findings 2004 | 셸(core)만. 채팅 UI는 원격 웹 번들이라 범위 밖 |
| Figma | 126.8.16 (설치본) | `resources/app.asar` → 수동 추출 디렉터리 (sha256 `236b671d…dec2d`) | `ev_cb5b5e7c…3259b` — contextBridge API 4, 노출 멤버 56, IPC 20 | asar 헤더의 `.codesign`(size −1000) 항목 때문에 REA asar 리더가 거부 → 자체 추출. `main.js`(3.5MB)는 300초 초과, `desktop_shell.js`는 1GiB 힙 초과로 **부분 분석** |
| Slack | 4.53.280 (공개 설치본 `SlackSetup.exe` → nupkg) | `lib/net45/resources/app.asar` (sha256 `4343eaae…e0041`) | `ev_29fc0d9d…b2b2a` — 모듈 816, findings 2940 | unpacked 네이티브 모듈 8개 무결성 불일치(서명 후 변경, 통상적) → record-and-continue |
| Notion | 2026-11-05 빌드 commit `2156431` (공개 설치본 NSIS → `app-64.7z`) | `resources/app.asar` 중 `clientMcpHost/` 디렉터리 (sha256 `27db8aae…2629`) | `ev_2208f5c6…2032a` — 35파일 전부 파싱 완료, findings 369 | 메인 번들(5MB)은 600초 초과 → MCP 호스트만 완전 분석. 나머지는 문자열 근거 |

Slack·Notion은 이 PC에 설치되어 있지 않아 공식 다운로드 URL에서 받은 설치본을 세션 임시 폴더에서만 풀었다(저장소에 포함하지 않음).

## 2. 관찰 → DevHub 응용

### 2.1 연결 복구 (Figma)
**관찰** — Figma 멀티플레이어 소켓 클래스(`main.js`): 상태 `{type: connected | connecting | disconnected(code, reason)}`, `backoff.nextBackoffMs()`로 재연결 지연 계산, `pingInterval`과 `getLastAckTime()`으로 무응답 감지, `visibilityObserver`로 탭 복귀 시 처리, `preventAutoReconnectOnNextClose`(의도된 종료는 재연결 안 함), `isReconnectScheduled()`. 세 앱 모두 `powerMonitor`의 `resume`/`suspend`/`lock-screen`을 구독한다(Discord `bundle.js`, Slack `main.bundle.cjs` 26회, Figma `main.js`). 한국어 문구: "Figma가 자동으로 다시 연결을 시도합니다."(`i18n/ko-kr.json`, `desktop.shell_app.error_tab.figma_will_automatically_try_to_reconnect`).

**DevHub 이전 상태** — `use-runner.ts`: 끊기면 고정 4초 후 재시도, 상태는 `closed`로만 표시, 핑 없음(폰이 잠들었다 깨면 반쯤 열린 소켓이 "연결됨"으로 남을 수 있음).

**적용** (`web/lib/runner/connection.ts`, `use-runner.ts`, `runner-settings-bar.tsx`, 러너 `server.ts`)
- `Backoff`: 1초 → 2 → 4 … 30초 상한, ±25% 지터, 연결 성공 시 리셋.
- 새 상태 `reconnecting` + `nextRetryAt`: 설정 바에 "끊김 · N초 후 다시 연결 / 자동으로 다시 연결합니다", 버튼은 "지금 연결".
- 핑/퐁: 25초마다 `{type:"ping", t}` → 러너가 `{type:"pong", t}` 응답(프로토콜 추가). 55초 넘게 퐁이 없으면 소켓을 닫아 백오프 루프로 넘긴다. RTT를 "연결됨 · 12ms"로 표시.
- `visibilitychange`/`online`/`focus`에서 재시도가 예약돼 있으면 즉시 연결(powerMonitor resume의 웹 대응물). 수동 종료(`disconnect`)와 인증 실패(4001/4029)는 재연결하지 않는다.

### 2.2 주의 배지와 알림 (Discord, Slack)
**관찰**
- Discord `bundle.js`: `setOverlayIcon(appIcons[index], "${index} notifications")`로 개수별 아이콘, 0이면 `setOverlayIcon(null)`; `flashFrame(!currentWindow.isFocused() && flag)` — **창에 포커스가 있으면 깜빡이지 않음**; `app.setBadgeCount`.
- Slack `main.bundle.cjs`: 배지 리소스 `unreads-badge/unread-badge-resources.json`을 읽어 `r[t > 99 ? 100 : t]`(99 초과는 "99+" 아이콘), 0이면 빈 이미지; Windows **Focus Assist** 상태를 유틸리티 프로세스로 조회(`getFocusAssistStatusViaUtilityProcess`, 2초 타임아웃, `{mode, hasPriority}`) — 방해 금지 중엔 우선순위 알림만 통과; `windowFlashBehavior` 설정과 `systemIdleStatus`에 따라 창 깜빡임.
- Slack `notifications.bundle.js`: 알림 이벤트 `DESKTOP_NOTIFICATION_{RECEIVED,SUCCESS,ERROR,CLICK,REPLY,ACTION,DISMISSED,FAILOVER}` — 알림에서 **인라인 답장**(`replyBox` 텍스트를 메시지 전송으로 dispatch)과, 네이티브 알림 실패 시 다른 경로로 **failover**.

**적용** (`web/lib/runner/use-attention.ts`, `connection.ts`, `components/control/notify-bar.tsx`, `public/sw.js`)
- 주의 수(실행 중이면서 입력 대기·오류·제안 있음)를 탭 제목 `(N) …`과 PWA 앱 배지(`navigator.setAppBadge`)에 표시, 99 초과는 `99+`, 0이면 지움.
- 상태 **전이**에만 알림: 작업 중 → 입력 대기, → 오류, 새 제안(확인 필요/제안), 실행 중 → 종료(완료/실패). 같은 상태 반복엔 안 울린다.
- Discord 규칙 그대로 **대시보드가 앞에 있으면(보이고 포커스) 알림을 띄우지 않는다**.
- Slack Focus Assist 대응 **방해 금지 모드**: 모두 알림 / 확인 필요만(오류·사람 확인 요청·실패 종료) / 방해 금지. `localStorage(devhub.notify)`에 저장.
- Slack 인라인 답장 대응: 입력 대기 알림에 **y⏎ / ⏎ / Esc 버튼**. 서비스워커 `notificationclick`이 열린 대시보드에 `postMessage`하고, 대시보드가 세션에 입력을 보낸다(워커는 러너 소켓을 갖지 않는다). 서비스워커가 없는 환경(dev·localhost)은 버튼 없는 `Notification()`으로 failover.
- 안드로이드 앱은 이미 러너 WebSocket으로 같은 알림(입력 대기·오류·완료·교차검증)을 띄우므로 변경 없음.

### 2.3 에이전트에게 열어 주는 폴더 정책 (Notion)
**관찰** — Notion 데스크톱은 **로컬 MCP 호스트**(`clientMcpHost/`)를 내장해 Notion 에이전트에게 `fs.list_roots / fs.list_directory / fs.create_directory / fs.get_file / fs.put_file` 다섯 도구만 준다(`tools/fs.js`). 정책(`policy/`): 루트 상대 경로만 허용(`isSafeRelativePath` — 빈 값·4096자 초과·백슬래시·절대경로 거부), 플랫폼별 보호 폴더와 금지 확장자(Windows: `Windows`, `Program Files(x86)`, `ProgramData`, `AppData`, `Recovery`, `$Recycle.Bin`, `System Volume Information`; `.exe .dll .lnk .msi .reg .vbs .scr .hta …`), "기존 파일은 절대 덮어쓰지 않음", 요청 큐 `concurrency`/`maxQueued` 고정 + abort, 원점 허용 목록(`notion.com`, `notion.so`, `makenotion.com`, 루프백은 포트 있는 http만), 공유 세션 `expires_at_ms` 만료.

**적용** (`runner/src/fsbrowse.ts`) — 폴더 탐색기(새 작업·관제 AI `fs` 도구 공용)가 위 Windows 보호 폴더 이름을 **대소문자 무시로 숨기고**, 경로 어디에든 들어 있으면 `시스템 폴더는 열 수 없습니다`로 거부한다. 기존 `RUNNER_CWD_ROOT` 상한·심링크 탈출 차단과 겹쳐 2중이다. 테스트 추가(`runner/test/fsbrowse.test.ts`).

### 2.4 Figma 셸 ↔ 웹 바인딩 (참고)
REA가 Figma 바인딩 렌더러에서 `contextBridge` API 4개·IPC 채널 중 `shell:getAgentStatus`, `shell:restartAgent`를 복원했다(로컬 FigmaAgent 헬퍼의 상태 조회·재시작). DevHub는 이미 `/runner/health`와 `devhubctl`이 그 역할을 하므로 추가 작업 없음.

## 3. 보류 (증거는 있으나 이번에 안 옮김)
| 패턴 | 출처 | 이유 |
| --- | --- | --- |
| 최근 닫은 탭 / 탭 고정 / 탭 그룹 | Figma `recentlyClosedTabs`·`reopenClosedTab`, Notion `pinTab`·`TabGroup`·`restoreTabs` | 작업 내역의 "이 지시로 다시"가 같은 역할. 세션 고정은 수요 확인 후 |
| 작업표시줄 썸바 버튼(음소거 등) | Discord `THUMBAR_BUTTONS_UPDATE` | 웹/PWA에서 대응 API 없음. 안드로이드는 알림 액션이 대신함 |
| 내부 진단 창(activity_monitor, sqlite_browser, net-log) | Notion 렌더러 엔트리, Slack `net-log-window.bundle.js` | RTT 표시로 최소만. 러너 이벤트 로그가 이미 있음 |
| 금지 확장자 목록 | Notion `policy/windows.js` | DevHub 탐색기는 폴더만 다룸. 파일 도구를 열 때 적용 |
| 모델 호출 큐 `concurrency/maxQueued` | Notion `queue.js` | 러너는 분당 12회 제한으로 이미 보호. 동시성 상한은 필요 시 |

## 4. 검증
- `web`: vitest 51/51 (신규 `test/connection.test.ts` 13개 포함), `tsc --noEmit` 통과, eslint 통과.
- `runner`: 96/97, `tsc` 통과. 실패 1건 `compiler.test.ts > caps runaway output`(Python 무한 출력 상한, 30초 타임아웃)은 이번 변경 파일을 stash한 상태에서도 똑같이 실패해 **기존 환경 문제**로 확인했다(이 PC의 Python 실행 경로/속도 영향 추정, 별도 조사 필요).
- 실브라우저에서 확인할 것: (1) 러너를 껐다 켜면 "끊김 · N초 후" 카운트다운과 자동 복귀, (2) 다른 탭으로 간 뒤 세션이 입력 대기로 바뀌면 알림, (3) 알림의 `y ⏎` 버튼이 세션에 들어가는지(프로덕션 빌드 + 터널 주소에서만 서비스워커가 등록됨).
