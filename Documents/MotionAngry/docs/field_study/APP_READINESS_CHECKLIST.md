# 현장 투입 전 앱 준비 체크리스트 (v0.1, 2026-10-30)

`docs/qa_checklist.md`(노트9에서의 기능 E2E: 알림→격자→기록, pending 보존, 모델 폴백, affect.csv v2, 회수→분석)는 이미 있으므로 반복하지 않는다. 이 문서는 **다른 사람의 폰에 4주 두는 것** 때문에 새로 생기는 항목만 다룬다. 각 항목은 날짜·기기·결과를 적고, 미완이면 설치 일정을 잡지 않는다.

상태 표기: `[ ]` 미완 / `[x]` 완료(날짜) / `[앱 변경 필요]` 코드가 없음 / `[설치 시 수기]` 연구자가 참가자 폰에서 손으로 하는 일

## 1. 기기 호환 (참가자 자기 폰 전제)

현재 빌드는 `targetSdk 29`, 노트9(Android 10)에서만 검증됐다. 참가자 폰은 Android 11~15가 대부분이다.

- [ ] Android 11+ 전경 서비스에서 카메라 사용: `foregroundServiceType="camera"` 선언, 백그라운드 카메라 제한으로 표정 기록이 멈추지 않는지 (화면 켜짐 + 다른 앱 전경 상태에서 `face_*.csv`에 행이 늘어나는지) `[앱 변경 필요 가능]`
- [ ] Android 12+ 정확한 알람: `SCHEDULE_EXACT_ALARM`(12~13) / `USE_EXACT_ALARM`(13+) 권한 없이 `setExactAndAllowWhileIdle`이 거부되는지. 거부되면 팔 B가 조용히 빠진다 → `ask_sched` 대비 `ask(arm=B)` 수로 탐지하되, 설치 시 권한 안내 추가 `[앱 변경 필요]`
- [ ] Android 13+ 알림 런타임 권한 `POST_NOTIFICATIONS` 요청 흐름 (없으면 "지금 어떠세요?" 알림이 전혀 안 뜸) `[앱 변경 필요]`
- [ ] Android 14+ `foregroundServiceType` 필수 선언(`dataSync`·`camera`·`specialUse` 중 선택)과 그에 따른 권한
- [ ] 제조사별 백그라운드 종료(삼성 '절전 앱', 샤오미·오포 등 자동 시작 제한): 설치 당일 저녁 `affect.csv`가 끊기지 않았는지 다음 날 확인하는 절차를 설치 안내문에 넣기 `[설치 시 수기]`
- [ ] 저장공간: `files/` 는 앱 전용 외부 저장소(`/sdcard/Android/data/<pkg>/files`)라 Android 11+에서 다른 앱·파일 관리자가 못 읽는다(장점). adb pull은 가능한지 기기별로 확인 → 안 되면 MTP 또는 앱 내 '내보내기(ZIP → Downloads)' 경로 `[앱 변경 필요 가능]`
- [ ] 테스트 매트릭스: 최소 Android 10(노트9), 12, 14 각 1대에서 24시간 무인 기록 후 `affect.csv` 행 수 ≥ 1,300(≈90%) 확인. 결과 표를 이 문서 끝에 추가

## 2. 동의 화면·참가자 코드 (T12, 미구현)

- [ ] `ConsentActivity`: 최초 실행에 동의서 4절 수집 항목 7종·보관 위치·외부 전송 없음·철회 방법을 표시, 동의 전 `LifeLogService` 시작 불가(adb `life_start` 포함, `onStartCommand`에서 재검사) `[앱 변경 필요]`
- [ ] 참가자 코드 입력란(`F\d\d` 형식 검증), 동의 시각·동의서 버전·코드를 `events.csv` `consent` 값(`code=F01;ver=0.1;at=<ms>;media_plain=0|1`)으로 기록 `[앱 변경 필요]`
- [ ] 곡/영상 제목·앱 이름 수집 토글(기본 off). off면 `app`·`media` 값을 SHA-256 앞 8자로 대체 — 해시가 `events.csv` 어디에도 원문을 남기지 않는지(알림 텍스트 포함) 확인 `[앱 변경 필요]`
- [ ] 설정의 '기록 삭제' 버튼: `files/life`·`files/models/student_*` 전체 삭제 후 `log_stop`, 삭제 전 확인 대화상자 `[앱 변경 필요]`
- [ ] 동의 화면 문구가 `CONSENT_FORM.md` 4절 표와 글자 수준으로 일치(IRB에 캡처 제출)

## 3. 기준선 모드와 학생 활성 전환 (PROTOCOL 3.1)

- [ ] 기준선 모드 플래그(`prefs baseline_until=<ms>`): 그 시각까지 `guard`가 `student_active=false`로 고정되고 전환을 기록하지 않음. 교사 라벨·학생 학습·`p_student_*` 기록은 계속 `[앱 변경 필요]`
- [ ] 설치일 + 7일 00:00에 자동 해제, `events.csv`에 `phase` `to=student_enabled;at=<ms>` 기록 `[앱 변경 필요]`
- [ ] 해제 뒤 DriftGuard가 과거 1주의 팔 B 채점을 창에 포함하는지(설계: 14일 롤링이므로 포함) — 포함하면 1주차 채점이 전환 판단에 들어가므로 `[PENDING: 포함 여부 결정, PREREGISTRATION_FIELD 5절에 기록]`

## 4. 권한·배터리 설정 안내 (설치 시 수기)

설치 안내문(A4 1장)에 아래 순서와 캡처를 넣고, 연구자가 참가자 폰에서 함께 진행한다.

- [ ] 권한: 카메라, 알림(13+), 사용 정보 접근(`PACKAGE_USAGE_STATS` → 설정 화면 이동), 다른 앱 위에 표시(`SYSTEM_ALERT_WINDOW`, 오버레이 '맞아요?'용), 정확한 알람(12+), 알림 접근(`MediaListener`, 곡 제목용 — 토글 off면 생략 가능)
- [ ] 배터리 최적화 제외: 설정 → 앱 → 배터리 → '제한 없음'. 삼성은 추가로 '절전 상태로 전환하지 않을 앱'에 등록. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 인텐트로 바로 열어 주기 `[앱 변경 필요 가능]`
- [ ] 자동 시작 허용(샤오미·오포·비보·화웨이)
- [ ] 설치 직후 확인: 상태 표시줄 상시 알림(id 2) 보임, `events.csv`에 `consent`, `log_start`, `ask_sched` 3건(`arm=B`), 1분 뒤 `affect.csv` 1행(67열, `v=3`), 화면 켠 상태 1분 뒤 `face_frames>0`
- [ ] 참가자에게 '알림이 하루 종일 안 오면 앱을 한 번 열어 주세요'(서비스 재시작) 안내

## 5. 로그 용량·시간 추정 (설치 전 저장공간 확인 근거)

| 파일 | 측정 근거 | 1일 | 4주 |
|---|---|---|---|
| `imu_*.csv.gz` | 저자 로그 2026-10-25: 시간당 3.4~4.1MB | 약 95MB | 약 2.7GB |
| `face_*.csv` | 2fps × 52계수 × 화면 켜진 시간; 4시간 기준 `[추정, 아래 항목으로 실측]` | 10~15MB | 0.3~0.4GB |
| `affect.csv` | 67열 분당 1행 | 약 1MB | 30MB |
| `events.csv` | — | <1MB | <30MB |

- [ ] 참가자 폰 테스트 24시간 뒤 `du`로 위 표를 실측값으로 갱신
- [ ] 설치 조건 "여유 저장공간 ≥ 5GB"를 앱이 시작 시 확인하고 미달이면 경고 `[앱 변경 필요 가능]`
- [ ] 4주를 넘겨도 기록이 계속되므로(상시 기록 원칙) 종료 방문이 늦어질 때의 용량 여유 확인(일 100MB)

## 6. 수동 내보내기·회수 절차 (DMP 3절의 실행 수단)

- [ ] 연구자 노트북에 adb 설치, Windows Git Bash에서 `MSYS_NO_PATHCONV=1 adb -s <serial> pull /sdcard/Android/data/kr.ac.seoil.motionaffect/files/ <회수루트>/F01/` 가 참가자 기기(USB 디버깅 켜야 함)에서 동작하는지. USB 디버깅을 켜기 꺼리는 참가자용 대안으로 앱 내 '내보내기(ZIP → Downloads)' 버튼 `[앱 변경 필요 가능]`
- [ ] 단말 쪽 체크섬: `adb shell "cd /sdcard/Android/data/kr.ac.seoil.motionaffect/files && find . -type f -exec sha256sum {} \;"` 가 해당 기기에서 되는지(busybox 없을 수 있음 → `toybox sha256sum`)
- [ ] 회수 스크립트 `scripts/field_pull.sh`(또는 `.ps1`): pull → 양쪽 체크섬 비교 → 파일 수·크기·기간 요약을 `field_log.md`에 append `[저장소 변경 필요, 이 패키지 범위 밖]`
- [ ] 회수 후 `python -c "import s8_common; ..."` 로 `load_affect`·`load_events`·`grid_taps`가 참가자 폴더를 읽는지(헤더 버전 섞임: `affect_old_*.csv` 포함)

## 7. 장애 시 연락·대응

- [ ] 앱 상태 카드에 "문제가 있으면 연락: 강정모 `[PENDING: 전화·메신저]`"와 참가자 코드 표시
- [ ] 연구자 대응표: (a) 알림이 안 옴 → 앱 열어 서비스 재시작, 그래도 안 되면 권한·배터리 설정 재확인(원격 안내) (b) 배터리 과소모 호소 → 그날 `imu_stats` 확인 후 중단 기준(PROTOCOL 7.1) 판단 (c) 앱 강제 종료 반복 → 로그캣 대신 `events.csv` `log_start` 반복 수로 판단, 재설치 (d) 폰 교체 → 종료 처리(제외 기준 3)
- [ ] 크래시 추적: INTERNET 권한이 없어 원격 보고 불가. `Thread.setDefaultUncaughtExceptionHandler`로 `files/life/crash_<ms>.txt`에 스택만 남기기 `[앱 변경 필요]`
- [ ] 주 1회 확인 메시지 양식(응답 강요 아님, 불편 질문 1개)

## 8. 빌드·배포

- [ ] `assembleRelease` 서명: 현재 debug 키 서명. 4주 동안 재설치 시 같은 키여야 데이터 보존 → 연구용 keystore 1개 고정, 백업 `[저장소 변경 필요]`
- [ ] 버전명에 프로토콜 버전 포함(`0.1-field`), `events.csv` `log_start` 값에 앱 버전 기록되는지
- [ ] APK 해시(SHA-256)를 IRB 제출 자료와 `field_log.md`에 기록, 참가자 전부 같은 APK
- [ ] `AndroidManifest.xml`에 INTERNET 권한이 없음을 빌드 산출물(`aapt dump permissions`)로 확인하고 기록 — 중단 기준 7.2 사전 점검
- [ ] 영상·이미지 저장 경로 부재 확인: 소스 전체에서 `ImageCapture`, `MediaRecorder`, `Bitmap.compress`, `.jpg/.png/.mp4` 쓰기 호출 grep 결과 0건을 기록

## 9. 실측 표 (채워 넣기)

| 날짜 | 기기 | Android | 24h affect 행 | face 행 | imu MB | 배터리 %/h(화면 꺼짐) | 비고 |
|---|---|---|---|---|---|---|---|
| | 노트9 SM-N960N | 10 | | | | | 기준 기기 |
| | | 12 | | | | | |
| | | 14 | | | | | |
