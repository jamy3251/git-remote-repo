---
name: devhub-runner
description: DevHub 로컬 러너(D:\Projects\Data\BaekDiscord\runner)로 이 PC의 CLI 에이전트 세션(Claude Code·Codex·셸)을 만들고, 출력을 읽고, 입력을 보내고, 관제 AI에 지시하는 방법. 세션을 여러 개 띄워 병렬 작업시키거나, 다른 Claude Code 세션의 상태를 확인하거나, 작업 폴더의 변경(git) 현황을 볼 때 사용. 트리거: "러너", "세션 띄워", "병렬로 돌려", "다른 세션 상태", "관제", "devhubctl".
---

# DevHub 러너 제어

러너는 `127.0.0.1:7331`에서 돌고, 모든 호출은 토큰이 필요하다. 토큰은 `runner/.runner-token` 파일 또는 `RUNNER_TOKEN`에 있고 `devhubctl`이 자동으로 읽는다.

## 러너 확인·시작

```bash
node D:/Projects/Data/BaekDiscord/runner/bin/devhubctl.mjs health
```

`ECONNREFUSED`면 러너가 꺼진 것이다. 백그라운드로 시작한다(절대 포그라운드로 기다리지 말 것):

```bash
cd D:/Projects/Data/BaekDiscord && npm run dev:runner
```

## 명령 (devhubctl = `node D:/Projects/Data/BaekDiscord/runner/bin/devhubctl.mjs`)

| 목적 | 명령 |
| --- | --- |
| 세션 목록(상태·마지막 줄·제안 포함) | `devhubctl sessions` (`--json`) |
| 일회성 Claude Code 작업 띄우기 | `devhubctl create --preset claude-print --cwd "D:\Projects\X" --prompt "테스트 돌리고 실패 원인 요약" --goal "..." --policy assist` |
| 대화형 세션 | `--preset claude` / `codex` / `shell`, 사용자 명령은 `--preset custom --command "npm run dev"` |
| 출력 읽기 | `devhubctl output <id> --lines 80` |
| 입력 보내기 (Enter 자동) | `devhubctl send <id> "y"` (Enter 없이: `--no-enter`) |
| 종료 | `devhubctl kill <id>` |
| 작업 폴더 변경 현황(git) | `devhubctl workspace <id>` |
| 슈퍼바이저 이벤트 로그 | `devhubctl events --limit 50` |
| 관제 AI에 자연어 지시 | `devhubctl chat "RunClue에서 테스트 돌려줘"` (파괴적 작업 허용: `--confirm`) |

HTTP로 직접 쓸 때는 `Authorization: Bearer <token>`, 경로는 `/runner/sessions`, `/runner/sessions/<id>/input` (`{"data":"y\r"}`), `/runner/sessions/<id>/output?lines=60`, `/runner/compile`, `/runner/chat`.

## 규칙

- 세션 `cwd`는 러너 루트(기본 `D:\Projects`) 안이어야 한다. 밖이면 400.
- `claude-print`/`codex-exec`는 프롬프트를 stdin으로 받아 한 번 실행하고 끝난다. 여러 폴더에 같은 지시를 뿌릴 때 가장 싸고 안전하다.
- 슈퍼바이저 정책: `manual`(관찰만) · `assist`(제안, 사람이 승인) · `auto`(안전한 입력만 자율). 삭제·force push·배포·비밀값이 보이면 정책과 무관하게 사람 확인으로 올라간다.
- 상태 값: `starting` `working` `waiting_input` `idle` `error` `done` `killed`. `waiting_input`이면 `output`으로 프롬프트를 읽고 `send`로 답한다.
- 세션을 만든 뒤 바로 결과를 기대하지 말고, 몇 초 뒤 `sessions`/`output`으로 상태를 본다. 한 번에 4개 이상 띄우지 말 것(이 PC는 메모리가 넉넉하지 않다).
- 다른 사람이 보는 채널(디스코드 알림 웹훅)로 출력이 나갈 수 있으니 비밀값을 출력에 찍지 말 것. 러너는 알려진 토큰 형태를 `[REDACTED]`로 가린다.
