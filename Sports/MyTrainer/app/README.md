# MyTrainer 앱

설계: `../docs/designs/mytrainer.md` (APPROVED + eng review, 작업 T1~T9)

## 지금 들어 있는 것 (T1~T3 일부)

- 출석 전용 모드(베이스라인): 온보딩(위치 권한 → 헬스장 30초 측정 → 밤 알림), 홈(오늘 출석, 밤 질문, 최근 2주)
- 네이티브 지오펜스: `android/app/src/main/kotlin/com/mytrainer/mytrainer/`
  - `GeofenceRegistrar` 등록(ENTER/EXIT/DWELL 20분), `GeofenceReceiver` 가 앱 종료 상태에서도
    `filesDir/geofence_events/<id>.json` 으로 적음, `BootReceiver` 재부팅 후 재등록
- `lib/services/geofence_service.dart` 폴더 큐를 읽어 업로드(멱등), WorkManager 15분 보완 확인
- `lib/services/session_rules.dart` 출석 판정·기록 누락률(분모 = 지오펜스 체류일 ∪ 밤 자기보고)

## 운동 기록 (T4)

- 사용 기간 모드에서 홈의 "운동 기록하기" → `lib/ui/log/`. 진행자가 홈 제목을 길게 눌러 베이스라인/사용 기간을 바꾼다
- 기록 키 = 종목 + 기구 변형(`lib/data/exercises.dart`), 미리 채우기·추정 1RM·최근 종목은 `lib/services/logging_rules.dart`
- 세트마다 탭 수·입력 시간(`taps`, `entryMs`)과 지오펜스 안 여부(`insideFence`, 출석 체크인으로도 사용)를 남긴다
- 주 1회 표본 날(그 주 첫 방문일) 밤 질문에서 실제 세트 수를 받아 세트 완결도를 낸다

## 영상 루틴 복사 (T9)

- 기록 화면 오른쪽 위 목록 아이콘 → 루틴 → "영상에서 가져오기": 유튜브 링크(공개·일부 공개) 또는 폰 영상(20MB 까지)
  → Gemini 가 종목·세트·횟수를 뽑음 → 앱 종목에 연결(못 붙인 건 직접 고름) → 저장하면 오늘 루틴
- 기록 화면 위 "오늘 루틴" 칩(오늘 한 세트/목표 세트)을 누르면 그 종목을 루틴 목표로 시작
- 프롬프트·스키마 `lib/routines/extract_spec.dart`, 종목 별칭 `lib/routines/exercise_linker.dart`
- 필요한 설정: Firebase 콘솔 → AI Logic 켜기(Gemini Developer API), App Check 에 Play Integrity 등록,
  디버그 빌드는 실행 로그에 나오는 디버그 토큰을 App Check 에 등록
- 평가: `tool/eval/README.md`

## 배포 빌드

`flutter build apk --release --split-per-abi` → `app-arm64-v8a-release.apk`(61MB, 대부분의 폰).
R8 규칙은 `android/app/proguard-rules.pro`(MediaPipe). 앱 내 업데이트(GitHub Releases)는 arm64 파일을 올린다.

## 스포터 모드·파티 (T8)

- 홈 오른쪽 위 사람 아이콘 → 파티: 내 초대 코드(8자리), 파티원, 코드로 들어가기, 내 이름
- 사용 기간 모드 홈 "스포터 모드" → 리프터 고르기(또는 삼각대로 직접) → 옆에서 전신 촬영, 무릎 각도로 스쿼트 횟수 세기 → 고쳐서 보내기
- 리프터 홈에 "OO님이 스쿼트 N회를 찍었어요" + 앱이 켜져 있으면 알림 → 무게 넣고 저장해야 기록(24시간 지나면 만료)
- 카운터 `lib/spotter/rep_counter.dart`, 각도 값은 `spotter_state.dart`. 관절 좌표 녹화가 촬영자 폰
  `Android/data/com.mytrainer.mytrainer/files/spotter_recordings` 에 남는다 → `tool/accuracy/rep_eval.dart`

## 기구 매칭 (T7)

- 기록 화면 오른쪽 위 아령 아이콘 → 기구 목록·등록(사진 2~3장 + 종류 + 종목). 이미 있는 기구와 닮으면 사진 추가를 먼저 권한다
- 기록 화면 "기구 사진으로 찾기"·카메라 아이콘 → 1위가 임계값 이상이면 확인 한 번, 아니면 상위 3개, 못 찾으면 목록
- 임베딩은 `android/.../MachineEmbedder.kt`(MediaPipe, `assets/models/mobilenet_v3_small.tflite`), 매처는 `lib/machines/matcher.dart`
- 서버 모드에서는 첫 기구 등록 때 나를 파티장으로 하는 파티를 만든다(파티 가입 화면은 아직 없음)
- 정확도 하네스: `tool/accuracy/README.md`. 임계값은 헬스장 사진으로 다시 정해야 한다

## 오프라인 (T6)

- 서버 모드에서 쓰기는 서버 확인을 기다리지 않는다(지하에서 기록 화면이 멈추지 않게). 읽기는 로컬 캐시에서
- `lib/data/offline_ready.dart` 연결돼 있을 때 서버에서 받아 캐시를 채우고 시각을 남긴다(앱 열 때 6시간 간격,
  당겨서 새로고침은 강제, WorkManager 도 시도). 홈 맨 아래에 "오프라인 준비됨 · 시각 · 올리기 전 N건",
  준비 안 됐거나 3일 지나면 노란 안내
- 기구·루틴 데이터가 생기면 `offlineParts()` 에 부분을 더한다

## 보안 규칙 (T5)

`firestore.rules` 에 데이터 구조와 권한이 같이 적혀 있다. 요약:

- `users/{uid}/...` 본인만(지오펜스 이벤트·밤 자기보고·세트 = 지표 원본)
- `parties/{pid}` 파티원만 읽음, 가입은 가입 코드(`inviteCode`)가 맞아야 함, 설정은 파티장만
- `parties/{pid}/attendance/{uid}_{날짜}` 공유 동의 + 숨기지 않은 본인만 씀, 파티원 읽기, 좌표 필드 거부
- `parties/{pid}/machines` 파티원 등록, 수정·삭제는 등록자 또는 파티장. 사진 임베딩은 `modelId`·`dim`·길이 맞는 `vector` 필수
- `parties/{pid}/pending_spots` 촬영자 생성(createdAt = 서버 시각), 촬영자·리프터만 읽음, 리프터만 24시간 안에 확정/거절(횟수 수정 가능)

테스트(Firebase 에뮬레이터, Java 필요):

```
cd firestore-tests
npm install
npm run emu      # 36개
```

## Firebase 연결 (없으면 이 폰에만 저장하는 로컬 모드로 동작)

1. Firebase 콘솔에서 프로젝트 생성, Android 앱 추가(패키지 `com.mytrainer.mytrainer`)
2. `google-services.json` 을 `android/app/` 에 넣기
3. `android/settings.gradle` plugins 에 `id "com.google.gms.google-services" version "4.3.15" apply false`,
   `android/app/build.gradle` plugins 에 `id "com.google.gms.google-services"` 추가
4. Authentication → 익명 로그인 켜기, Firestore 생성 후 `firestore.rules` 배포
   (규칙 배포: `firebase deploy --only firestore:rules`)
5. AI Logic(Gemini Developer API)·App Check(Play Integrity) 켜기 — 영상 루틴 복사용
6. 첫 실행은 와이파이에서(익명 로그인이 필요)

## 확인

```
flutter test           # 판정 규칙·이벤트 큐·기록 규칙·오프라인 준비·매처·반복 카운터·루틴 추출·화면 107개
flutter build apk --debug
```

실기기에서 볼 것: 앱을 종료한 상태로 헬스장 진입·이탈 시 출석이 찍히는지와 지연 시간,
베이스라인 전 3~5일은 실제 방문일과 대조해 감지율 기록(설계 D12).
