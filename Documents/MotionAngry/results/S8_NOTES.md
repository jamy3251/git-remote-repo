# S8 구현 기록 (설계 docs/designs/motionangry-ondevice-loop.md, 리뷰 결정 R1~R13)

## 2026-10-24 T1 — 질문 알림 두 팔 (AskScheduler)
- AskScheduler.java: 팔 A(급변 0.25·30분, 기존) + 팔 B(하루 3회 09~23시 난수, B끼리 ≥30분, A 직후 15분이면 미룸). 계획은 prefs에 저장 → 재시작·재부팅에도 같은 시각 재등록(ask_sched 중복 없음). 기록 type: ask_sched(arm=B;idx;at;future), ask(arm=A|B;pa;pv), ask_delay.
- AskAlarmReceiver.java: AlarmManager setExactAndAllowWhileIdle 수신 + BOOT_COMPLETED(life_running 플래그일 때만 서비스 재시작; 동의 게이트는 T12).
- LifeLogService: maybeAsk 제거, 알림 src=ask_A|ask_B, 중지 시 알람 취소·플래그 해제. 매니페스트 RECEIVE_BOOT_COMPLETED.
- 단위 테스트 AskSchedulerTest 8/8 (gradle testReleaseUnitTest, JUnit 4.13.2 추가).
- 기기: 18:13 설치·시작, ask_sched 3건(오늘 지난 2건 future=0, 22:15 1건), dumpsys alarm에 22:15·00:00 RTC_WAKEUP 확인.

## 2026-10-24 T2 — affect.csv v2 + 자세 규칙 + 표정 분 집계
- AffectRow.java: 분당 1행 64열(기존 8 + v,screen_on,tilt_deg,held,face_frames,face_rate,smile_mean,jaw_mean + m_16 + s_med_16 + s_iqr_16), 키 오름차순 고정, 결측 빈 값. 5분 미만이어도 행 기록(p 빈 값).
- PostureRule.java: tilt=acos(|gz|/|g|), held=화면∧15~80°∧std>0.01g, flat=<15°∧std≤0.01g, other. 임계값 초안(R3 조정 기간에 재조정).
- FaceRecorder: 분 집계 {frames, faces, smile(mouthSmileL/R 평균) 합, jawOpen 합}, drainMinute(). DailyEngine.lastMinute().
- 기존 v1 affect.csv는 affect_v1_<ms>.csv로 보관.
- 테스트 PostureRuleTest 6/6, AffectRowTest 2/2. 총 16/16.

## 2026-10-24 T3 — 모델 파일 로더·pending 이벤트·숫자 파싱 통일
- ModelFiles.java: files/models/<name> 우선, 손상·부재면 assets 폴백, events.csv type=model_load(source=files|assets, error).
- StudentModel.java: 표준화+로지스틱(s7 own_model과 같은 계산) 텍스트 형식(logistic N names / mu / sd / w / b). 손상 파일은 IOException → 폴백.
- PendingEvents.java: 서비스 꺼짐 중 좋아/별로·격자 입력을 pending_events.csv에 보관, 시작 시 events.csv에 병합(type=pending_merged). 꺼진 서비스가 입력 인텐트로 반쯤 켜지던 경로 제거(stopSelf, START_NOT_STICKY).
- Fixtures.parseDouble: 'nan'/''/'NaN'/'null' → NaN 한 곳에서. MainActivity selftest도 사용.
- 테스트: FixturesParseTest 3, StudentModelTest 2, PendingEventsTest 2 → 누적 23/23.
- 기기 검증 18:17: life_stop 상태에서 격자 저장 → pending_events.csv 1행 → life_start → events.csv에 병합(affect src=main), model_load source=assets, pending 파일 삭제. affect.csv v2 첫 행 64열 확인(tilt 1.5°, held=0, face_frames 115).

## 2026-10-24 T4~T8 — 학생 씨앗·분석 파이프라인·테스트·QA
- T4 export_daily.py --student: K-EmoPhone 전체 표준화+로지스틱 씨앗(student_arousal/valence.txt, 각 2.5KB, 학습 AUROC 0.636/0.600 참고치) + selftest_student.txt. JUnit StudentModelFixtureTest가 Java 계산과 1e-9 일치 확인.
- T5 s8_teacher.py: 표정 분 집계(smile_mean, jaw_mean, face_rate≥0.3)로 의사 라벨. 임계값은 처음 k일(3·5·7)에서만: 팔 B 탭 ≥20이면 일치율 최대화, 아니면 70백분위. 조정 탭 ID·조정 날 기록.
- T6 s8_student.py: 조정 날 교사 라벨로 학생 학습(s8_common.Student = s7 own_model), k일 이후 팔 B 탭에서 출하/학생/블렌드 AUROC(a>0·v>0, n≥20), 스피어만+원형이동 순열, j 일치율(팔별), A 부표본, 누락률, held/other 분리, 누출 단언. 학생 가중치 results/models/student_<task>_k<k>.txt(단말 files/models 형식).
- T7 테스트: pytest 11(라벨 이진화·n 게이트·j 배제·누출·순열 FFT 방향·팔 부표본·누락률·로지스틱 왕복) + JUnit 24 → 전부 통과. CLAUDE.md Testing 절 작성. 【미실시】 골든 픽스처(10-20 로그 1시간 + s5_life 결과 CSV) — s5_life.py의 RAW 상수를 파라미터화한 뒤 작성 예정(R13 수용 단언의 일부).
- T8 docs/qa_checklist.md 작성(1·2·4 통과 기록, 3·5·6 미수행).
- 실데이터 실행(2026-10-24 1일, affect 6행, 탭 3건 모두 manual): 파이프라인 끝까지 동작, 모든 분할 'n 부족', 누락률 1.0은 22:15 팔 B 알람이 아직 안 울린 상태라 정상.
- 주의: adb pull 등 상대 경로 명령은 cwd가 android/로 바뀐 상태에서 실행되면 엉뚱한 곳에 들어감 → 절대 경로 사용.

## 2026-10-24 T11 — LiteRT 온디바이스 학습 프로브 (R10/D11) → 통과
- 모델: src/train_head.py — 32개 요약 특징 표준화 + 로지스틱, train(SGD lr 0.05, 기울기 닫힌 식)·infer 시그니처, 내장 연산자만(head.tflite 9.4KB). GradientTape 자동 미분은 BroadcastGradientArgs(비내장)를 만들어 변환 실패 → 로지스틱 기울기를 수식으로 써서 해결. save/restore 포함판(head_ckpt.tflite 12KB)은 TF 선택 연산자 필요 → 2단계에서 flex 위임으로 별도 확인.
- 의존성: org.tensorflow:tensorflow-lite:2.16.1 추가, MediaPipe tasks-vision 0.10.35와 빌드·로드 충돌 없음. APK 19.0→22.5MB.
- 노트9 3회(files/litert_probe.txt): 100스텝 학습 22.7~44.4ms(스텝당 0.23~0.44ms), 모델 로드 2.3~34.8ms, 추론 8건 0.6ms, 메모리 증가 0.9~1.3MB, Python 기준 확률 최대 차 6.0e-8, 손실 0.6931→0.5140 일치. 실패 기준(>5초·>100MB·>1e-4·충돌) 모두 미해당 → PASS.
- 결정: 2단계 학생 학습은 LiteRT로 진행(D2 유지). 체크포인트(save/restore)는 flex 위임 추가 후 재확인; 대안은 가중치를 Java에서 읽어 StudentModel 텍스트로 저장(이미 있는 로더 재사용).
- PC TFLite 인터프리터도 TF와 6e-8 일치(초기 가중치 0으로 되돌린 뒤 내보내야 함 — 처음엔 학습된 가중치를 내보내 0.064 차이가 났음).

## 2026-10-24 T13·T14·T15 — 2단계 학습 루프·가드·배치 모드 (코드 완료, 기기 초기화 확인)
- T13: TeacherRule.java(표정→의사 라벨, files/models/teacher_params.txt 없으면 비활성), ContactGate.java(충전 중 또는 화면 꺼짐+1분 정지면 비접촉 → 추정 보류·기록 계속; S9로 검증: 충전 창 AUROC 0.591 vs 0.624, 창 18% 보류), OnDeviceTrainer.java(LiteRT head.tflite train/infer + get_weights/set_weights로 체크포인트 대용 → files/models/student_<task>.txt), affect.csv v3(67열: +p_student_a, p_student_v, contact). 1시간마다 표본 ≥50이면 100스텝 학습·저장(type=train). 격자 값에 psa/psv 추가.
- T14: DriftGuard.java(팔 B 탭마다 출하·학생 채점, 14일·n≥15·−0.10/+0.05, type=guard, 학생 활성 플래그 prefs). 활성이면 알림·팔 A에 학생 추정 사용.
- T15: 배치 모드(prefs batch_mode; cmd batch_on/off, batch_plan "cont,batch,…" × seg_min) — 화면 꺼짐 동안 자이로 해제·가속도 NORMAL+maxReportLatency 300s, type=sensor_mode·batch_plan_seg; 5분마다 imu_stats(수신 수·eff_hz·최대 간격·배터리 level·charge_uah). 【미실시】 ABAB 4시간 실험(폰 시간 필요).
- 기기 19:40: teacher=none(임계값 파일 없음 — k일 조정 뒤 push), student 두 과제 초기화(samples 0), affect v3 67열 첫 행, 충전 중이라 contact=0(추정 보류)으로 기록됨 — USB 연결 중엔 추정이 멈추는 것이 규칙대로의 동작.
- 교훈: TFLite Java runSignature는 빈 입력 맵을 거부 → 입력 없는 시그니처에 더미 입력을 둔다.
- 테스트: TeacherContactTest 3, DriftGuardTest 4 추가 → JUnit 31, pytest 11.

## 2026-10-24 T16·T17·T18 — ESP32 이식·외부 데이터셋 로더·KCI 골격
- T16 esp32/: features.c/.h(Features.java의 C 이식, float32 — ESP32는 FPU가 있어 고정소수점 대신 float32 채택, 설계와의 차이로 기록), test_pc.c(PC 검증: selftest_daily 3건 88창, 32개 요약 특징 최대 상대오차 5.6e-4 float32 vs float64, 특징 계산 22.7µs/창 on PC), gen_weights.py → student_weights.h(씨앗 로지스틱), motion_affect_esp32.ino(MPU-6050 8Hz 읽기, 'b' 벤치/'l' 로거/'r' 실행 모드). 【미실시】 실보드 컴파일·µs·전류 측정(IMU 모듈 미입수; 'b' 모드는 IMU 없이 가능 → 보드만 있으면 바로).
- T17 src/s10_external.py: Empatica E4 ACC.csv(32Hz) 로더 → 5분 창 2Hz 요약 32 + 32Hz 원시 특징, data/processed/nurse_windows.parquet. 【미검증】 데이터 미입수. DAPPER 로더 미구현.
- T18 paper/KCI_원고_초안.md: 구성·확정 수치(S4·S6·S7·S9·S11·T11)·【미실시】 자리(1단계 게이트, 배치 전력, ESP32, 참가자 n) 표시.
- T16 추가(20:05): arduino-cli(esp32 core 3.3.11)로 motion_affect_esp32 컴파일 성공 — 플래시 308,116B(23%), 전역 RAM 32,660B(9%). 보드 미연결(COM3은 폰 모뎀뿐)이라 업로드·µs·전류는 【미실시】.
- T15 실험 시작(20:03:50): batch_plan cont,batch,cont,batch × 60분, batterystats reset. 구간 전환 21:03/22:03/23:03, 종료 00:03. 조건: USB 분리·화면 꺼짐 유지 필요(imu_stats에 screen/charging 기록되어 사후 필터 가능).
- R13 골든 픽스처(20:10): tests/golden/life/2026-10-20(10-20 18:49~19:49 imu 1시간 3.9MB + 표정 24파일 + events) → tests/golden/expected(s5_life 4개 CSV; 1시간: 표정·움직임 749초, 검출률 60%, 좋아/별로 11건). tests/test_golden.py가 s5_life 재현(rtol 1e-9)과 events 열·type 보존을 단언. s5_life.py에 MA_LIFE_RAW/MA_RESULTS 덮어쓰기 추가. pytest 13/13.

## 두 번째 학술대회 원고 (2026-10-24 밤)
- paper/학술대회2_온디바이스_자기학습_원고.md: 오늘 완료·검증분만(S7 누적, S9 게이팅, S11 비식별성, T11 단말 학습 비용 회차별, 기기 동작, ESP32 PC 오차·컴파일 크기). 1단계 게이트·배치 전력·ESP32 실측·외부 데이터는 결과에 넣지 않고 한계·향후에만. 본문 8,753자(공백 포함)+표 4+그림 1.
- 그림 paper/figures/fig_loop.png(make_figures.py loop_diagram, "질문" 라벨 위치 수정). 표 4 회차별 값은 단말 litert_probe.txt(/sdcard/Android/data/.../files)에서 재확인: 읽기 34.8/2.5/2.3ms, 학습 44.4/24.7/22.7ms, 메모리 0.9/1.3/1.3MB, model_bytes 9368.
- 참고문헌 [4][6][7][8]은 첫 논문과 동일, [2][3][5][9]는 새로 추가.

## 2026-10-25 — 폰 재연결 후 (S12·S13, 학생 씨앗 결함 수정, 교사 활성화)
- 폰 files/life 전체 pull → data/raw/life/2026-10-25/ (10-24 부분 pull은 data/raw/life_archive/2026-10-24_partial로 이동, 중복 방지). affect v3 360분(10-24 257, 10-25 103), 격자 입력 추가 없음(ask B 22:33 응답 없음). 기록은 10-25 01:55 사용자가 중지 → 16:xx 재시작.
- S12 배치 ABAB 분석(src/s12_batch.py, results/S12_NOTES.md): 통제 창(화면 꺼짐·비충전 5분) 연속 225 vs 배치 203mAh/h 중앙값, IQR 겹침, 배치 창 유효 Hz 1~55로 통제 실패 → 전력 이점 확인 못 함(【측정·차이 없음】).
- S13 창 길이 실험(src/s13_window.py, results/S13_NOTES.md): 1분 0.594/0.603 → 15분 0.625/0.638, 30분 0.621/0.631 → 60분 0.614/0.622(각성 전체/사용자별, 같은 응답 3,160건). 정서가는 30분 최고 0.585/0.607. 저자 질문("왜 30분")의 데이터 근거.
- 결함: OnDeviceTrainer가 저장 파일이 없으면 0 가중치로 시작하고 첫 저장이 0을 덮어써 p_student가 항상 0.5였음(affect v3 319행 전부 0.5). 수정: 저장 파일 없거나 손상이면 assets/student_<task>.txt 씨앗을 set_weights로 복원, student 이벤트에 source=files|assets|zero 기록. gradle testReleaseUnitTest+assembleRelease 통과(JUnit 31), APK 22.5MB 설치, 폰의 0 가중치 student_*.txt 삭제 → 재시작 로그 w0=0.1412 source=assets(씨앗과 일치).
- 교사: s8_teacher.py 이틀 기록(얼굴 31분) → theta_v 0.0004 / theta_a 0.0235(70백분위, 격자 탭 <20이라 일치율 조정 불가) → results/models/teacher_params.txt를 폰 files/models/에 push, 재시작 로그 teacher theta_v=0.0004;theta_a=0.0235;conf_min=0.30. 이제 순환 전체가 폰에서 동작(학습은 1시간에 표본 50개 이상일 때만).
- 참고문헌 6편 다운로드·해석 paper/refs/ (Aldenhoven ARKit, Hosseini 간호사 E4, LiteRT 가이드, MediaPipe, Affect Grid, K-EmoPhone). 원고 수정: LiteRT "마지막 층" 서술 삭제(공식 예제는 수만 파라미터 분류기 전체 학습), MediaPipe는 프레임워크 인용으로, Affect Grid는 변형임을 명시, K-EmoPhone 응답은 "설문 직전 순간"이며 평균 26분 지속 보고를 30분 창 근거로.

## 2026-10-25 밤 — 앱 화면 다듬기(논문 그림 3용) + 디자인 리뷰 2건 반영
- Ui.java 신설(바탕 #F6F7FB, 흰 카드 20dp, 알약 칩·버튼, 막대, 알약 상태, 안쪽 상자, 구분선). MainActivity: NoActionBar 테마, 제목·설명·"인터넷 권한 없음" 알약, 상태 카드(기록 중 알약·최근 추정 막대·표정 교사·학생 모델), 기록 토글 버튼 + "지금 기분 남기기", 권한 카드(허용 여부 표시). AffectGridActivity: 앱 안 이름 "기분 지도", 추정 카드 압축(막대 2개 한 줄), 격자 둥근 모서리·감정 이름 알약 배경·축 라벨 밝기 적응·선택 후광, 칩 가장자리 정렬. 오버레이(좋아/별로/기분)는 앱 화면이 앞에 있을 때 브로드캐스트(ACTION_OVERLAY)로 숨김. 알림 제목 "폰 안에서 기분을 읽는 중", 버튼 "기분 남기기". 서비스가 최근 추정을 prefs(ui_pa/ui_pv/ui_min/ui_at)에 남김.
- 캡처: adb 데모 모드(상태바 정리) → paper/figures/shots/01_main.png·02_grid.png(기쁨 근처 탭 상태) → make_figures.screens() → fig_screens.png(그림 3). 이전 화면은 shots_before/.
- 빌드·설치(JUnit 31 통과), 기록 재시작. 기록 형식·모델·규칙은 변경 없음.
