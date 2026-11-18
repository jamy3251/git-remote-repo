# DevHub 관제: 공식 기능 대비 위치와 hook 확인

작성 2026-11-15. 근거: `devhub-next-20261113.md`의 "공식 기능 대비 위치 관문"과 "hook 확인 스파이크". Claude Code 2.1.325, Windows 10.

이 문서는 세 부분이다. 1) 공식 문서 기준 비교, 2) hook을 실제로 돌려 본 결과, 3) 사용자가 직접 해야 하는 실측(공식 기능 실사용, 무인 폰 시험). 3은 아직 비어 있다.

## 1. 공식 기능 대비 위치 (문서 기준)

출처: code.claude.com의 remote-control, agent-view, desktop(Dispatch), hooks, settings 문서. 직접 써 본 결과가 아니라 문서를 읽은 결과다. 실사용은 3절.

| 공식 기능 | 하는 일 | 조건 |
| --- | --- | --- |
| Remote Control (`claude remote-control`, `/rc`) | PC에서 도는 Claude Code 세션을 claude.ai/code나 Claude 폰 앱에서 보고 지시. 서버 모드는 기본 32개 동시. 조치 필요 시 폰 푸시(`/config`에서 켬) | Pro 이상 구독 로그인. API 키 불가. Codex 언급 없음 |
| Agent View (`claude agents`, `claude --bg`) | 터미널 한 화면에서 백그라운드 세션 여러 개 관리. 권한 프롬프트는 agent view에서 답함 | 연구 미리보기. 폰 승인·푸시 문서에 없음 |
| Dispatch (Cowork) | 대화 하나에서 Claude Code 세션으로 일을 보냄. 끝나거나 승인 필요 시 폰 푸시 | Pro, Max, Ultra. Team·Enterprise 불가 |

계획 항목 판정:

| 항목 | 판정 | 처리 |
| --- | --- | --- |
| 폰에서 Claude Code 세션 보기·지시·푸시 | 공식이 이미 한다 | Claude 세션만 쓰는 날은 Remote Control로 충분하다. DevHub는 README에 이 사실을 적고 경쟁하지 않는다 |
| 여러 세션 한 화면 | 공식이 이미 한다(Claude 한정) | 최소 구현 유지. 새 화면 투자 안 함 |
| 세션 재개 버튼 | 곧 할 것 같다 | 재개 요약(resume brief)까지만. 버튼은 착수하지 않음 |
| 승인 카드(폰에서 권한 승인) | Claude는 공식이 한다. Codex·셸은 안 할 것 | "여러 회사 CLI에 필요"로 관문 통과. 단 Codex·셸 세션을 먼저, Claude 세션은 hook 신호(2절)로 |
| 자동 응답(슈퍼바이저), 판단 기록, 성과 지표 | 안 할 것 | 계획대로 진행. 이 프로젝트의 고유한 부분 |
| Claude↔Codex 교차 리뷰 | 안 할 것 | 유지 |
| 같은 폴더 동시 작업 경고 | 안 할 것 | 계획대로 |
| 자체 터널·페어링 | Claude는 공식이 클라우드 중계로 해결(터널 불필요) | Codex·셸 원격 때문에 유지. 인증 전환은 계획대로 하되 "Claude만이면 공식을 쓰라"를 화면에 안내 |

결론: DevHub의 자리는 "여러 회사 CLI를 한 곳에서, 자율 판단과 그 기록까지"다. Claude 단독 원격 조작은 공식에 맡긴다.

## 2. hook 확인 스파이크 (실제 실행)

방법: 이벤트마다 페이로드와 시작·끝 시각을 파일에 적는 hook 스크립트를 `claude --settings <파일>`로 넘겼다. 헤드리스(`-p`, haiku) 한 번, node-pty로 띄운 대화형 한 번(`--permission-mode default`). 스크립트는 세션 밖 임시 폴더에 두었고 저장소에는 넣지 않았다.

계획이 확인하라고 한 네 가지:

1. **`--settings` 병합.** 합쳐진다. `--settings`의 Stop hook과 사용자 전역 `~/.claude/settings.json`의 Stop hook(gstack)이 같은 실행에서 둘 다 돌았다(gstack 쪽 캐시 파일이 그 시각에 생김). 대화형 화면에도 "running Stop hooks… 0/2"로 나온다. 따라서 세션별 설정 파일 방식은 사용자 설정을 지우지 않는다. 계획대로 간다.
2. **페이로드 필드.** 실측(2.1.325):
   - 공통: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, 대부분 `prompt_id`, `permission_mode`, `effort`, 대화형에서는 `scratchpad_dir`.
   - SessionStart: `source`. UserPromptSubmit: `prompt`. PreToolUse: `tool_name`, `tool_input`, `tool_use_id`. PostToolUse: 위에 더해 `tool_response`, `duration_ms`.
   - PermissionRequest: `tool_name`, `tool_input`, `permission_suggestions`. `tool_use_id`가 없다. PreToolUse와 짝지으려면 `prompt_id`와 `tool_input`으로 맞춰야 한다.
   - Notification: `notification_type`(관측: `idle_prompt`, 메시지 "Claude is waiting for your input", 마지막 응답 약 60초 뒤), `message`.
   - Stop: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`. SessionEnd: `reason`.
   - 환경 변수 `DEVHUB_SESSION`과 세션 비밀값이 hook 프로세스까지 전달된다. 세션 찾기 설계는 그대로 된다.
3. **hook이 기다리는 동안 권한 프롬프트가 뜨는가.**
   - PreToolUse: 뜨지 않는다. 6초 자는 PreToolUse가 끝난 뒤 63ms 만에 프롬프트가 보였다. 즉 PreToolUse는 도구를 막는다. 여기에 느린 일(네트워크 왕복)을 두면 모든 도구 호출이 그만큼 느려진다.
   - PermissionRequest: 동시에 뜬다. 프롬프트가 보인 뒤 80ms에 PermissionRequest hook이 시작됐고, hook이 자는 동안 터미널에서 Esc로 거절할 수 있었다. 터미널에서 답하면 hook은 끝 기록 없이 정리됐다.
4. **시한.** `timeout`은 초 단위. 3초 시한에 8초 자는 PreToolUse는 끝 기록 없이 끊겼고 도구는 그대로 실행됐다(공식 문서: 기본 600초, 시한 초과 시 결과 버림, `onFailure: "block"`일 때만 막음). `"async": true`는 막지 않고 시한도 적용되지 않는다.

계획 수정(이 결과로 바뀌는 것):

- 상태 전이 신호는 PermissionRequest, Notification, Stop, UserPromptSubmit을 쓴다. 모두 `async: true`로 등록해 hook이 Claude를 붙잡지 않게 한다. PreToolUse는 등록하지 않는다(막는 hook이라 지연만 늘린다).
- 승인 카드(Claude 세션)는 hook 출력으로 결정하지 않는다. 터미널 프롬프트가 이미 떠 있으므로 지금처럼 PTY 키 입력으로 답한다. hook은 "프롬프트가 떴다"는 확실한 신호와 `tool_input` 원문을 주는 역할만 한다. 출력 꼬리 판정은 Codex·셸용으로 남긴다.
- PermissionRequest에 `tool_use_id`가 없어 PostToolUse와 바로 묶을 수 없다. 판단 기록은 `session_id + prompt_id + tool_name + tool_input 해시`로 묶는다.
- `idle_prompt`는 약 60초 뒤에야 온다. "입력 대기"를 빨리 띄우는 데는 Stop이 맞고, idle_prompt는 "놓친 대기" 지표(5분 넘게 방치)의 보조 신호로 쓴다.

스파이크 중 찾은 것 두 가지:

- **부모 Claude Code 세션 표시 상속.** 러너를 Claude Code 안에서 띄우면(`npm run dev`를 Claude에게 시킨 경우) `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` 등이 자식 세션까지 내려가고, 자식 `claude`는 "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker"를 띄운다. 그러면 그 세션은 나중에 재개할 수 없다. `runner/src/sessions.ts`의 `SESSION_ENV_DENY`에 이 표시들을 추가해 고쳤다(사용자 설정용 `CLAUDE_CODE_USE_BEDROCK` 같은 변수는 유지, 테스트 있음).
- **처음 보는 폴더의 신뢰 확인 기본값이 "No, exit".** 러너가 새 폴더에서 세션을 띄우고 Enter를 자동으로 보내면 세션이 바로 종료된다. 슈퍼바이저 자동 응답이 이 화면에 Enter를 보내지 않는지, 화면에 "폴더 신뢰 확인 필요"로 보이는지 hook 신호 단계에서 확인한다(TODOS).

## 2-1. hook 신호 구현 (2026-11-18)

2절의 계획 수정대로 넣었다. 코드: `runner/src/hooks.ts`, `runner/bin/devhub-hook.mjs`, `runner/src/overlap.ts`, `runner/src/danger.ts`.

- **주입 대상.** 명령이 `claude`로 시작하는 대화형 PTY 세션(프리셋 `claude`, `claude-continue`, `dclaude`와 `devhubctl claude`). 프리셋 이름이 아니라 명령 줄에서 읽어 세션 정보의 `agent`와 `interactive`에 적는다. `-p`, 사용자가 직접 넘긴 `--settings`, 다른 명령을 잇는 줄(`&&`, `|` 등)에는 붙이지 않는다.
- **방식.** 세션마다 `runner/.data/hooks/<세션 id>.json`을 만들어 `--settings`로 넘긴다. 등록 이벤트는 SessionStart, UserPromptSubmit, PermissionRequest, PostToolUse, Notification, Stop이고 모두 `async`다. PreToolUse는 없다. 스크립트는 페이로드를 `POST /runner/hooks`로 보내고 아무것도 출력하지 않으며 항상 0으로 끝난다. 러너가 꺼져 있거나 3초 안에 답하지 않으면 `runner/.data/hook-errors.log`에 한 줄 남긴다. 세션이 끝나면 설정 파일을 지우고, 러너 시작 때 남은 파일도 지운다.
- **인증.** 세션별 비밀값(`DEVHUB_HOOK_SECRET`)과 `DEVHUB_SESSION`. 로컬 리스너에서만 받고 터널 리스너에서는 404다. 관리자 토큰은 hook 자격으로 통하지 않는다. 비밀값은 정확 일치 마스킹 목록에 올라 판단 엔진 프롬프트, 작업 내역 꼬리, 알림에서 가려진다. 오류 코드는 `hook_unknown_session`, `hook_bad_secret`, `hook_duplicate`.
- **상태 전이.** SessionStart → 지시 대기, UserPromptSubmit·PostToolUse → 작업 중, PermissionRequest → 입력 대기(도구와 명령 또는 대상 파일을 사유에 표시, 위험 패턴은 `tool_input`으로 판정), Stop → 입력 대기(응답 끝). hook이 시작된 시각보다 오래된 신호는 버려서 늦게 온 async hook이 상태를 되돌리지 못한다. 권한 프롬프트에 답이 입력되면(사람, 관제 AI, 슈퍼바이저) 그 자리에서 작업 중으로 바꾼다. PostToolUse는 도구가 끝나야 오기 때문이다.
- **출력 판정과의 관계.** hook이 한 번이라도 온 세션은 hook이 이긴다. 예외는 하나다. hook은 작업 중인데 화면에 선택지·예/아니오·Enter 프롬프트가 있고 60초 동안 아무 출력이 없으면 화면을 믿고 "추정"으로 입력 대기를 띄운다(hook이 알려 주지 않는 대화 상자 대비). 세션 카드의 상태 옆에 "확정"(hook) 또는 "추정"(출력)이 붙는다.
- **판단 기록.** `signal`이 `hook`인 기록에는 `hook: { claudeSessionId, promptId, tool, inputHash }`가 붙는다. 휴리스틱 재실행은 hook 기록을 건너뛴다.
- **실측(Claude Code 실물, 2026-11-18).** 러너가 띄운 `claude` 세션에서 SessionStart로 세션 id를 받았고, 지시 한 줄에 "작업 중 → 입력 대기(응답 끝)"가 1초 간격으로 hook만으로 바뀌었다. 3건 수신, 거절 0건. 권한 프롬프트(PermissionRequest)와 `dclaude` 경로는 실물로 아직 안 봤다(단위 테스트만).

설정:

| 이름 | 기본값 | 뜻 |
| --- | --- | --- |
| `RUNNER_HOOKS` | 켜짐 | `0`이면 hook을 붙이지 않는다. 모든 세션이 "추정"이다 |
| 세션 생성의 `hooks: false`, `devhubctl create --no-hooks` | - | 그 세션만 끈다 |
| 세션 생성의 `allowOverlap: true`, `devhubctl create --allow-overlap` | - | 겹치는 폴더 경고를 확인한 것으로 보고 시작한다 |

한계:

- 세션 안의 에이전트는 자기 hook 비밀값을 환경 변수로 읽을 수 있어 hook 신호를 위조할 수 있다. 승인 결정은 바꾸지 못하지만(결정은 터미널 입력뿐) 상태 표시와 지표를 흐릴 수 있다.
- 자율 정책의 허용 목록(읽기 전용 도구, 작업 폴더 안 편집)은 아직 없다. 지금 자율 응답은 예전처럼 판단 엔진 제안과 위험 패턴으로 정해진다. 승인 카드와 같이 2차에서 한다.
- 같은 폴더 경고는 러너가 띄운 세션끼리만 본다. 러너 밖에서 연 Claude 창은 모른다.

**폴더 신뢰 확인 화면.** 문구("Is this a project you created or one you trust?", 기본 선택 "No, exit", "Enter to confirm")를 실물에서 받아 출력 판정에 넣었다. "폴더 신뢰 확인 필요"로 입력 대기가 되고, 판단 엔진을 부르지 않으며, 제안은 "사람 확인"뿐이라 자율 정책에서도 Enter가 나가지 않는다. 고치기 전에는 "Enter to confirm"이 일반 Enter 프롬프트로 읽혀 자율 정책이 Enter를 보냈고 세션이 끝났다.

**같은 폴더 경고.** 실행 중인 쓰기 세션의 폴더와 같거나 그 상위·하위에 새 세션을 띄우면 러너가 `folder_busy`로 멈추고 겹치는 세션을 돌려준다. 경로는 실제 경로와 소문자로 맞춰 비교한다(정션, 대소문자). 대시보드는 "기존 세션 열기 / 그래도 시작 / 취소" 창을 띄우고, `dclaude`는 y/N을 묻고, 관제 AI는 만들지 않고 사용자에게 묻는다. 읽기 전용 교차검증 세션은 대상이 아니다. 교차검증은 세션이 끝난 시점에 저장한 diff 사본(`runner/.data/diffs/<id>.diff`)을 읽는다.

## 3. 사용자 실측 (비어 있음)

- 공식 Remote Control과 Agent View로 실제 작업 몇 건: 아직. 사용자 구독 로그인과 폰 앱이 필요하다. 해 본 뒤 1절 표의 "공식이 이미 한다"가 맞는지 고친다.
- 무인 장시간 폰 시험(2시간 넘는 작업, PC를 떠나 폰만으로 알림·승인·결과 확인): 아직. 실패 지점을 여기 적는다.
