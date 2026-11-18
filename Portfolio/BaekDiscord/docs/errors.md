# 러너 오류 코드

러너의 HTTP 오류 본문과 WebSocket `error` 메시지는 같은 필드를 가진다.

```json
{ "error": "no such session", "code": "session_not_found", "fix": "세션 목록을 새로 받아 id를 확인하세요...", "retry": "no" }
```

- `error`(WS에서는 `message`): 사람이 읽는 원문. 예전 클라이언트용으로 남겨 둔다. 분기에는 쓰지 않는다.
- `code`: 고정된 영어 식별자. 아래 제목이 코드이고, 링크는 `docs/errors.md#<code>`.
- `fix`: 고칠 방법 한 줄.
- `retry`: `no`(다시 보내도 같다), `after_ms`(기다리면 된다. `retryAfterMs`가 있으면 그만큼), `after_fix`(`fix`대로 고친 뒤).
- `traceId`: 예기치 못한 실패(`internal`)에만 붙는다. 원문은 응답에 넣지 않고, 비밀값을 가린 뒤 러너 이벤트 로그에 `내부 오류 <traceId>: ...`로 남긴다.

코드 목록의 원본은 `runner/src/errors.ts`다. 새 코드를 넣으면 이 문서와 `web/lib/runner/labels.ts`에도 넣는다. 빠지면 러너와 웹 테스트가 실패한다.

## bad_request
400, `after_fix`. 필수 필드가 비었거나 값이 틀렸다(빈 지시, 프롬프트가 필요한 프리셋에 프롬프트 없음, 지원하지 않는 언어 등). `error`에 어느 필드인지 적혀 있다.

## invalid_json
400, `after_fix`. HTTP 본문이나 WS 메시지가 JSON이 아니다.

## body_too_large
413, `after_fix`. 본문 상한을 넘었다. 대부분 64KB, 컴파일 요청 1MB, 코드 200KB.

## unknown_message
400, `no`. 러너가 모르는 WS 메시지 종류다. 웹과 러너 버전이 다를 때 생긴다. `npm run check:protocol`로 두 프로토콜 사본을 비교한다.

## not_found
404, `no`. 경로나 대상(작업 내역, 프로덕트)이 없다. 러너 API는 `/runner/` 아래에 있다.

## host_not_allowed
403, `after_fix`. 로컬 포트에 `localhost`, `127.0.0.1`이 아닌 Host로 들어왔다(DNS 재바인딩 방어). 원격은 터널 주소를 쓴다.

## origin_not_allowed
403, `after_fix`. 허용되지 않은 Origin에서 온 요청이다. 대시보드를 러너 주소에서 열거나 `RUNNER_ALLOWED_ORIGINS`에 주소를 넣는다.

## auth_invalid
401, `after_fix`. 토큰이 틀렸다. HTTP 응답에는 `remainingAttempts`가 붙는다. 러너 시작 로그의 토큰을 다시 넣거나 PC 화면의 QR을 다시 찍는다. WS는 이어서 4001로 닫힌다.

## auth_required
401, `after_fix`. 인증 전에 다른 메시지를 보냈다. 연결 직후 `hello`로 토큰을 보낸다.

## auth_locked
429, `after_ms`. 인증 실패가 반복돼 이 클라이언트가 잠겼다. `retryAfterMs` 뒤 올바른 토큰으로 다시 시도한다.

## rate_limited
429, `after_ms`. 요청이나 모델 호출이 너무 잦다. 간격을 늘린다.

## busy
409, `after_ms`. 같은 일이 이미 진행 중이다(관제 AI 응답, 교차검증, 요약). 끝난 뒤 다시 보낸다.

## session_not_found
404, `no`. 세션 id가 없다. 종료 후 제거됐을 수 있다. 세션 목록을 새로 받는다.

## session_limit
409, `after_fix`. 동시에 돌 수 있는 세션 수에 닿았다. 끝난 세션을 정리하거나 `RUNNER_MAX_SESSIONS`를 늘린다.

## cwd_outside_root
403, `after_fix`. 고른 폴더가 `RUNNER_CWD_ROOT` 밖이다.

## path_forbidden
403, `no`. 시스템 폴더이거나 루트 밖을 가리키는 링크다.

## folder_missing
404, `after_fix`. 폴더가 없다.

## folder_busy
409, `after_fix`. 새 세션의 폴더가 실행 중인 쓰기 세션의 폴더와 같거나 그 상위·하위다. 응답의 `overlaps`에 겹치는 세션(`id`, `name`, `cwd`, `relation`: `same`, `parent`, `child`, `root`)이 들어 있다. 기존 세션을 쓰거나, 그래도 시작하려면 요청에 `allowOverlap: true`를 넣어 다시 보낸다. 읽기 전용 교차검증 세션은 대상이 아니다.

## hook_unknown_session
404, `no`. `POST /runner/hooks`에 온 세션 id가 없거나, 그 세션에 hook이 붙어 있지 않거나, 이미 끝났다. hook 스크립트는 이 응답을 `runner/.data/hook-errors.log`에 적고 조용히 끝난다.

## hook_bad_secret
403, `no`. hook 호출의 비밀값이 세션의 것과 다르다. 세션마다 새 값을 쓰므로 다른 세션의 값은 통하지 않는다.

## hook_duplicate
409, `no`. 같은 호출 id의 hook이 이미 처리됐다. 다시 보내도 상태는 바뀌지 않는다.

## preset_unknown
400, `after_fix`. 없는 프리셋 id다. `GET /runner/presets`의 목록을 쓴다.

## cli_missing
503, `after_fix`. 필요한 프로그램이 없다(claude, codex, 컴파일러, 요약 모델). 설치하고 PATH에 넣은 뒤 러너를 다시 시작한다.

## remote_forbidden
403, `no`. 원격 기기에서는 할 수 없는 동작이다(예: 터널 열기). PC에서 한다.

## demo_unsupported
501, `no`. `npm run demo`의 가짜 러너는 이 기능을 흉내 내지 않는다. 실제 러너(`npm run dev`)에서 쓴다.

## internal
500, `after_ms`. 예기치 못한 실패다. 응답의 `traceId`로 러너 이벤트 로그에서 `내부 오류 <traceId>`를 찾으면 원인이 있다. 계속되면 그 줄을 이슈로 남긴다.
