# 메신저 알림

러너가 세션의 진행을 내 메신저로 보냅니다. 관제 화면을 열어 두지 않아도 시작, 입력 대기, 완료를 알 수 있습니다.

## 언제 오나

| 일 | `NOTIFY_EVENTS` 이름 | 내용 |
|---|---|---|
| 세션 시작 | `start` | 이름, 프리셋, 폴더 이름, 목표 |
| 입력 대기, 슈퍼바이저 제안 | `wait` | 왜 멈췄는지, 제안한 답. 세션마다 1분에 한 번까지 |
| 세션 끝 | `done` | 완료/실패/중단, 걸린 시간, 바뀐 파일 수와 줄 수, 요약 |
| 교차검증 결과 | `review` | 통과, 수정 필요(P1 건수), 실패 |
| 진행 상황 요약 | `digest` | 실행 중인 세션마다 상태와 경과 시간. 실행 중인 세션이 없으면 보내지 않음 |

보내는 내용은 세션 이름, 상태, 파일 수, 짧은 요약입니다. 코드 본문은 넣지 않고, API 키처럼 생긴 문자열은 가린 뒤 보냅니다.

## 설정

환경 변수를 넣고 러너를 다시 시작합니다. 채널은 여러 개를 같이 켤 수 있고, 한 채널이 실패해도 나머지는 갑니다.

| 변수 | 뜻 | 기본값 |
|---|---|---|
| `SUPERVISOR_NOTIFY_WEBHOOK` | 디스코드 웹훅 주소 | 없음 |
| `NOTIFY_TELEGRAM_TOKEN` | 텔레그램 봇 토큰 | 없음 |
| `NOTIFY_TELEGRAM_CHAT_ID` | 메시지를 받을 대화방 id | 없음 |
| `NOTIFY_KAKAO_REST_KEY` | 카카오 앱의 REST API 키 | 없음 |
| `NOTIFY_KAKAO_CLIENT_SECRET` | 카카오 앱에서 Client Secret을 켰을 때만 | 없음 |
| `NOTIFY_KAKAO_TOKEN_FILE` | 카카오 토큰 저장 위치 | `runner/.data/kakao.json` |
| `NOTIFY_DIGEST_MIN` | 진행 상황 요약 간격(분). 0이면 끔 | 30 |
| `NOTIFY_EVENTS` | 보낼 일을 쉼표로. 예: `wait,done` | 전부 |
| `NOTIFY_LINK_URL` | 카카오 메시지 버튼이 여는 주소 | `http://127.0.0.1:7331/control` |

확인은 관제 화면의 "메신저 알림" 줄에서 합니다. 켜진 채널과 보내는 일이 보이고, "시험 보내기"와 "진행 상황 보내기"를 누르면 채널별 결과가 바로 아래에 나옵니다. 채널을 켜고 끄는 것은 환경 변수로만 합니다.

터미널에서도 같은 일을 할 수 있습니다:

```
devhubctl notify status   # 켜진 채널, 보내는 일, 요약 간격
devhubctl notify test     # 채널마다 시험 메시지, 결과를 채널별로 출력
devhubctl notify now      # 지금 진행 상황을 바로 보내기
```

## 텔레그램

1. 텔레그램에서 `@BotFather`에게 `/newbot`을 보내 봇을 만들고 토큰을 받습니다.
2. 만든 봇과의 대화방을 열고 아무 말이나 한 번 보냅니다. 봇은 먼저 말을 건 사람에게만 보낼 수 있습니다.
3. 브라우저에서 `https://api.telegram.org/bot<토큰>/getUpdates`를 열어 `chat.id` 값을 찾습니다.
4. `NOTIFY_TELEGRAM_TOKEN`, `NOTIFY_TELEGRAM_CHAT_ID`를 넣고 러너를 다시 시작합니다.

## 카카오톡 (나에게 보내기)

카카오톡 메시지 API의 "나에게 보내기"를 씁니다. 내 계정의 "나와의 채팅"으로 옵니다.

1. [카카오 개발자 콘솔](https://developers.kakao.com)에서 애플리케이션을 만듭니다.
2. 앱 키에서 REST API 키를 복사해 `NOTIFY_KAKAO_REST_KEY`에 넣습니다.
3. 카카오 로그인을 켜고 Redirect URI에 `http://localhost:7341/kakao/callback`을 등록합니다.
4. 동의항목에서 "카카오톡 메시지 전송"(`talk_message`)을 사용으로 바꿉니다.
5. 같은 환경 변수를 넣은 터미널에서 `devhubctl kakao login`을 실행하고, 출력된 주소를 브라우저에서 열어 동의합니다. 토큰이 `runner/.data/kakao.json`에 저장됩니다(git에 올라가지 않는 폴더).
6. 러너를 다시 시작하고 `devhubctl notify test`로 확인합니다.

알아 둘 것:

- 액세스 토큰은 러너가 알아서 갱신합니다. 리프레시 토큰까지 만료되면 알림 실패가 이벤트 로그에 남고, `devhubctl kakao login`을 다시 하면 됩니다.
- 텍스트 메시지는 200자에서 자릅니다. 진행 상황 요약처럼 긴 글은 뒤가 잘릴 수 있어, 세션이 많으면 텔레그램을 같이 쓰는 편이 낫습니다.
- "나와의 채팅"은 내가 나에게 보낸 메시지라 소리 알림이 오지 않을 수 있습니다. 자리를 비웠을 때 바로 알아야 하면 텔레그램이나 디스코드를 같이 켜 두세요.
- 포트 7341을 못 쓰면 `devhubctl kakao login --port <다른 포트>`로 바꾸고, 같은 주소를 Redirect URI에 등록합니다.

## 실패했을 때

- `devhubctl notify test`가 채널별로 실패 이유를 보여 줍니다(`telegram 403`, `kakao 401` 등).
- 러너 이벤트 로그에 `알림 실패(채널): 이유`가 남습니다. 같은 실패는 1분에 한 줄까지만 적습니다.
- 알림이 실패해도 세션과 관제 화면은 그대로 동작합니다.
