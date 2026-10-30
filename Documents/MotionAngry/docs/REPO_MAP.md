# REPO_MAP — MotionAngry 저장소 지도 (2026-10-30 감사판)

새 엔지니어가 한 번 읽고 모든 것을 찾을 수 있도록 만든 지도다. 경로는 저장소 루트(`D:\Projects\Documents\MotionAngry`) 기준이며, 줄 번호는 2026-10-30 커밋 `1ce64ff` 시점의 파일 기준이다. 코드가 바뀌면 줄 번호는 어긋날 수 있으니 함수·클래스 이름으로 다시 찾는다.

연구 한 줄 요약: 폰(또는 손목) 가속도 → 1분 특징 16개 → 직전 30분 요약 32개 → 출하 트리 모델(LightGBM 50트리×잎3)로 각성·정서가 확률 → 폰 안에서 표정 교사(MediaPipe 블렌드셰이프)로 의사 라벨을 만들어 학생 로지스틱(LiteRT)을 갱신 → 성능 가드가 무작위 질문(팔 B) 응답으로 출하/학생을 전환. 설계·결정 원장은 `docs/designs/motionangry-ondevice-loop.md`, 인사이트 장부 `docs/evolve_loop.md`, 실험 노트 `results/S*_NOTES.md`.

## 0. 디렉터리 한눈에

| 경로 | 내용 |
|---|---|
| `src/` | Python 분석·내보내기 스크립트 28개(`s1`~`s18`, `features.py`, `export_*.py`, `train_head.py`, `make_figures.py`, `build_paper_docx.py`). 패키지 아님: 서로 `import s4_kemophone as S4`처럼 같은 폴더에서 import하므로 `cd src && python s7_cumulative.py` 또는 `python src/s7_cumulative.py`(s13 이후 스크립트는 `sys.path.insert`로 자기 폴더를 넣음) |
| `tests/` | pytest 5파일 13개 + 골든 픽스처 `tests/golden/{life,expected}` |
| `android/` | 측정·일상 기록 앱 `kr.ac.seoil.motionaffect` (순수 Java, 레이아웃 XML 없음). `app/src/main/java/kr/ac/seoil/motionaffect/` 24파일, `app/src/test/.../` JUnit 9파일 31개, `app/src/main/assets/` 모델·픽스처 |
| `esp32/` | Features.java의 C 이식(float32) + Arduino 스케치 + PC 검증 하네스 (실보드 미측정) |
| `data/raw/` | (git 무시) `kemophone/P*.zip`+`SubjData.zip`, `WESAD/S*/S*.pkl`, `dataset_rds/`(StudentLife), `life/<날짜>/`(폰 로그), `life_archive/` |
| `data/processed/` | (git 무시) parquet 캐시 10개 + `head_saved*/`(TF SavedModel) |
| `results/` | 실험 결과 CSV·로그·노트(`S*_NOTES.md`), `models/teacher_params.txt`, `s3/files`(단말 측정 원본), `s5/`(파일럿 원본) |
| `paper/` | 원고 md 4편, docx 2개, `figures/`, `refs/`(참고문헌 해석 md; PDF는 git 무시), `kr/manuscript.md`(학술대회2와 동일 복사본), `sci/`(빈 폴더) |
| `docs/` | 설계·장부·문헌·리뷰·QA 문서 |
| `experiments/{common,guard_sim,loop_sim}` | 2026-10-30 생성된 빈 폴더(루프 시뮬레이터 예정지, 코드 없음) |
| 루트 | `CLAUDE.md`(테스트 명령·규칙), `TODOS.md`, `RESEARCH_PLAN.md`, `PAPER_GUIDE.md`, 참고 논문 PDF 다수(git 무시) |

## 1. K-EmoPhone 전처리

### 원시 데이터
- `data/raw/kemophone/P01.zip` … `P77.zip` (77명) + `SubjData.zip`. 각 `P*.zip` 안: `Acceleration.csv`(손목 가속도, `timestamp`(ms),`x`,`y`,`z`, 약 8Hz), `ActivityEvent.csv`(폰 OS 활동 신뢰도 8열), `ActivityTransition.csv`, `ScreenEvent.csv`(ON/UNLOCK/OFF), `ChargeEvent.csv`(CONNECTED/DISCONNECTED), `AppUsageEvent.csv`. `SubjData.zip` 안: `EsmResponse.csv`(pcode, responseTime, valence, arousal, stress …), `UserInfo.csv`(Big Five·PSS·PHQ).
- 접근 신청 문안: `docs/kemophone_access_request.md`. 논문 해석: `paper/refs/ref_Kang2023_KEmoPhone_해석.md`.

### 공통 상수·함수 (`src/s4_kemophone.py`)
- `FS = 8`, `PRE_MIN = 30`, `MIN_COVER = 0.5`, `GAP_MS = 1000` (L30–33).
- `uniform(acc_t, acc_xyz, t0, t1)` L38: `[t0, t1)`을 8Hz 격자로 선형 보간, 인접 원시 표본 간격이 1초를 넘는 격자점은 NaN.
- `summarize(rows, prefix)` L52: 창별 특징 DataFrame → 중앙값 `{prefix}_med_*`, IQR(75−25) `{prefix}_iqr_*`.
- **주의**: `ESM = pd.read_csv(zipfile.ZipFile(RAW / "SubjData.zip").open("EsmResponse.csv"))`가 모듈 최상위 L101에 있어 `import s4_kemophone`만 해도 데이터가 필요하다. 이를 import하는 스크립트: `s6_build_2hz`, `s4b_personality`, `s9_contact_rules`, `s13_window`, `export_daily`, (간접) `s14_bootstrap.part_c`.

### 30분 창 정의
ESM 응답 시각 `t1 = responseTime`(ms epoch). 창 = `[t1 − 30·60,000, t1)`. 8Hz 격자 14,400점을 60초(480점)씩 30개 비중첩 창으로 나누고, NaN이 하나라도 있는 분은 버린다. 응답을 쓰는 조건: 격자 커버리지 ≥ 50%(`MIN_COVER`) 이고 완전한 분 ≥ 5개(`len(per) >= 5`). 각 분에서 16개 특징(§2)을 구해 분들의 중앙값·IQR로 요약 → 32개. 폰(`DailyEngine.java`)도 같은 규칙(`KEEP_MIN=30`, `MIN_WINDOWS=5`)이다.

### 세 parquet과 만드는 스크립트

| 파일 | 스크립트·함수 | 크기 | 열 |
|---|---|---|---|
| `data/processed/kemophone_esm_features.parquet` | `src/s4_kemophone.py` `participant()` L59 → `build()` L104 (ProcessPool 6) | 5,582행 × 127열 (응답 전부; 손목 창이 있는 3,771건만 `n_win` 채워짐) | `pcode,t,valence,arousal,stress`, `phone_confidence*`·`phone_n_events`·`phone_n_trans`(OS 활동), `wrist_cover`, `n_win`, `raw8_/raw4_/raw2_{med,iqr}_*`(scipy `decimate` 다운샘플 — 단말 재현 불가), `coarse_{med,iqr}_*` |
| `data/processed/kemophone_2hz_block.parquet` | `src/s6_build_2hz.py` `block2()` L21(8Hz 4개 평균→2Hz), `participant()` L27, `main()` L53 | 3,771행 × 38열 | `pcode,t,valence,arousal,stress,n_win` + `b2_med_<16>` + `b2_iqr_<16>` — **단말 탑재 모델의 학습 데이터**(S6 이후 모든 실험의 기본 입력) |
| `data/processed/kemophone_window_sweep.parquet` | `src/s13_window.py` `participant()` L32, `main()` L84 (없으면 생성) | 3,339행 × 187열 | `pcode,t,valence,arousal,stress`, `n_{1,5,10,15,30,60}`, `w1_<16>`(직전 1분 그대로), `w{5,10,15,30,60}_{med,iqr}_<16>`. 응답 조건: 직전 60분 커버리지 ≥50% ∧ 직전 5분에 완전한 분 ≥3; 창별 완전한 분이 창 길이의 절반 이상일 때만 특징 |

열 뜻: `pcode` 참가자 ID(P01…), `t` ESM 응답 벽시계 ms, `valence`/`arousal`/`stress` ESM 원점수(−3…+3 정수), `n_win` 완전한 분 수, `rank` = 사용자 안 시간순 응답 번호(0부터; `s7_cumulative.load()` L34 `groupby("pcode").cumcount()`가 붙임; `s11`도 같은 방식), `b2_med_hp_mean` 등은 §2의 특징 이름.

### 라벨 이진화 규칙
- 기본(모든 K-EmoPhone 실험): `y = (d[task] > 0).astype(int)` — 0과 음수는 0. 예: `s7_cumulative.py` L65, `s13_window.py` L104, `s14_bootstrap.py` L139.
- 변형: `s4_kemophone.main` L148 `user_mean`(사용자 평균 초과), `s17_label_sensitivity.py`(사용자 중앙값 초과, 동률 제외), `s17b_zero_excluded.py`(0 응답 제외 후 >0), `s1_affect.py` L25 StudentLife는 `valence>0`, `arousal>=3`.
- 폰 격자 탭(R2): `src/s8_common.py` `binarize()` L79 — `>0→1`, `<0→0`, `==0`·NaN→NaN(제외). 자바 가드도 `a==0`은 채점 안 함(`LifeLogService.scoreGuard` L441).

## 2. 1분 특징 16개와 30분 요약 32개

### Python 원본: `src/s1b_wesad.py`
- `stats(x, p)` L30: `{p}_mean, _std, _p10, _p90, _iqr`.
- `spectral(x, fs, p)` L35: `scipy.signal.welch(nperseg=min(n, fs*8))` → `{p}_domf`(최대 전력 주파수), `{p}_sent`(스펙트럼 엔트로피), 대역 비율 `{p}_bp0.1-1`, `_bp1-3`, `_bp3-8`, `_bp8-16`(대역 하한 < fs/2 일 때만 → 2Hz에서는 `bp0.1-1` 하나).
- `raw_feats(acc, fs, orient=True)` L45: `mag = |acc|`, `hp = mag − medfilt(mag, 2fs+1)`; `stats(hp,"hp") | spectral(hp)`; `jerk = diff(mag)·fs` → `stats(|jerk|,"jerk")`; 초 단위 표준편차 `sec` → `sec_std_mean`, `sec_std_cv`, `still_frac`(sec<0.01 비율). `orient=True`면 축별 stats·pitch·roll 추가(WESAD 전용). **fs=2, orient=False → 정확히 16개**: `hp_mean, hp_std, hp_p10, hp_p90, hp_iqr, hp_domf, hp_sent, hp_bp0.1-1, jerk_mean, jerk_std, jerk_p10, jerk_p90, jerk_iqr, sec_std_mean, sec_std_cv, still_frac` (8Hz 18개, 32Hz 19개).
- `coarse_feats()` L64: OS 활동 범주 흉내(3범주 비율·전이).
- 32차원 요약: `s4_kemophone.summarize()`(접두어 `b2_`), `src/export_daily.py` `summarize()` L26(접두어 없이 `med_*`, `iqr_*` — 앱 assets 이름). 앱 CSV의 `s_med_*/s_iqr_*`, 분 특징 `m_*`는 키 오름차순(`AffectRow.keys()`).

### Java 이식: `android/app/src/main/java/kr/ac/seoil/motionaffect/`
- `Features.java` `compute(double[][] acc, int fs)` L14 → `Map<String,Double>` 16개. 내부: `stats` L45, `spectral` L56(welch: 주기형 Hann, 50% 겹침, 구간 평균 제거, density 보정), `fft` L119(반복형 radix-2, 길이 2^k만), `medfilt` L146(가장자리 0), `percentile` L161(numpy linear).
- `DailyEngine.java`: `grid8(t, xyz, n, tEnd)` L30(60초를 8Hz 격자로 선형 보간, 1초 공백이면 null), `block4()` L46(4개 평균 → 2Hz), `addMinute()` L58(`Features.compute(block4(win8), 2)` 저장, 30분 밖 분 제거), `summarize()` L72(`med_`/`iqr_`), `estimate()` L92(분 ≥5면 `{p_arousal, p_valence}`), `lastMinute()` L103.
- ESP32: `esp32/features.c/.h` `ma_block4`, `ma_features`, `ma_summarize`, `ma_logistic`(이름 순서 `MA_FEAT_NAMES` = AffectRow 오름차순).

### 폰–Python 일치 검사
- 단말 selftest: `MainActivity.selftest()` L294(WESAD 창 5개 × 2/8/16/32Hz, `assets/model{fs}.txt` + `assets/selftest{fs}.txt`) 과 `selftestDaily()` L355(`assets/selftest_daily.txt` K-EmoPhone 3명 30분 신호 → 32특징 최대 상대오차·확률 오차·분 단계/추정 단계 µs) → 폰 `files/selftest_result.txt`. 실행: `adb shell am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd selftest`. 픽스처 생성: `src/export_model.py` `selftest()` L78, `src/export_daily.py` `selftest()` L50. 기록된 결과: 특징 상대오차 ≤2.3e-14, 확률 오차 0(`results/S3_NOTES.md`, I14).
- JUnit(기기 불필요): `StudentModelFixtureTest.seedModelsMatchPythonFixture` — `assets/student_{arousal,valence}.txt` + `selftest_student.txt`(Python 확률)와 1e-9 일치. Features.java 자체를 PC에서 검사하는 JUnit은 없다(selftest가 그 역할).
- ESP32: `esp32/test_pc.c`(gcc)로 `selftest_daily.txt` 88창 재계산, float32 최대 상대오차 5.6e-4(I23).

## 3. LightGBM 기본(출하) 모델

- 하이퍼파라미터 `DEPLOY`(`src/s7_cumulative.py` L25): `n_estimators=50, learning_rate=0.05, num_leaves=3, min_child_samples=20, subsample=0.8, subsample_freq=1, class_weight="balanced", verbose=-1`. 같은 값이 `src/export_daily.py` `PARAMS` L21(+`colsample_bytree=1.0`), `src/s9_contact_rules.py` L22에 복제돼 있고, `s13`·`s14`·`s15`~`s18`은 `from s7_cumulative import DEPLOY/load/base_loso/own_model`로 재사용. 크기 선택 근거는 `src/s6_params.py` D절(`tree_bytes()` L109, 트리×잎 격자) → `results/s6_model_size.csv`, I7.
- WESAD용 큰 모델 `W.PARAMS`(`s1b_wesad.py` L26): 200트리·잎15 — `model{2,8,16,32}.txt`(S3 비용 측정용).
- 학습·내보내기: `src/export_daily.py` `train(d, task)` L33 — `kemophone_2hz_block.parquet` 전체(3,771건)로 `(task>0)` 학습 → `android/app/src/main/assets/daily_arousal.txt`, `daily_valence.txt`. 평탄화 형식은 `src/export_model.py` `flatten()` L45: 첫 줄 `features N name…`, `trees T`, 트리마다 `tree n` 뒤 노드 n줄 — 잎 `L value`, 내부 `N split_feature threshold default_left left_idx right_idx`. 읽는 쪽 `TreeModel.java` L15(`predict` = sigmoid(잎 합); `default_left`는 읽지 않음, 결측 특징은 `vector()`에서 예외).
- LOSO 함수들: `s7_cumulative.base_loso(d, feats, y)` L38(참가자 1명 제외 학습, OOF 확률), `s4_kemophone.loso()` L117(큰 모델, 지표 dict), `s6_params.loso_auc()` L39, `s13_window.loso()` L66, `s14_bootstrap.loso_oof(d, feats, y, seed)` L49, `s9_contact_rules.loso_auc()` L63. 개인 모델 `s7_cumulative.own_model(tr_x, tr_y, te_x)` L47(자기 평균·표준편차 표준화 + `LogisticRegression(C=0.1, class_weight="balanced")`), `safe_auc()` L56.
- 내보낸 모델 파일: `android/app/src/main/assets/daily_{arousal,valence}.txt`(각 ~7.8KB, 2026-10-21), `model{2,8,16,32}.txt`(~170KB, 10-09), 학생 씨앗 `student_{arousal,valence}.txt`(§4), `head.tflite`/`head_ckpt.tflite`. `results/models/`에는 **`teacher_params.txt`만** 있다 — `s8_student.py`가 쓰기로 한 `results/models/student_{task}_k{k}.txt`는 데이터 부족으로 아직 생성되지 않음(`docs/qa_checklist.md` 3항이 가리키는 `student_arousal_k7.txt`도 없음).
- OOF 캐시(있으면 재사용, 다시 계산하려면 삭제): `data/processed/s14_window_oof.parquet`(3,160×16: `p_{task}_w{W}`), `s14_cumulative_oof.parquet`(3,072×7: `p_base,p_own,p_blend`), `s14_contact_oof.parquet`(3,771×9), `s14_contact_ctx.parquet`(5,582×5: `screen_on, charging, app_events`). 생성 `src/s14_bootstrap.py` `part_a/b/c`.

## 4. LiteRT 학생 모델

### Python: `src/train_head.py`
- 상수 `N_FEAT=32, BATCH=64, STEPS=100, LR=0.05` L21–24. `build_and_export()` L27: `kemophone_2hz_block.parquet`의 `b2_*` 32열로 `mu, sd`(전체 3,771건 통계, sd=0→1)를 **모델 상수**로 박고, `w=0, b=0`으로 시작하는 `tf.Module Head`.
- 시그니처: `infer(x[N,32]) → p` L51; `train(x[N,32], y[N,1]) → loss` L55 — `z=(x−mu)/sd`, `logit=z·w+b`, `p=sigmoid`, `loss=mean(sigmoid_cross_entropy)`, 기울기 **닫힌 식** `g=p−y`, `gw = zᵀg/n`, `gb = Σg/n`, `w −= LR·gw`, `b −= LR·gb` (받은 배치 전체로 1 스텝; GradientTape를 쓰면 `BroadcastGradientArgs`가 TFLite 내장 연산자가 아니어서 변환 실패 → 수식으로 대체). `get_weights(dummy)` L70(빈 입력을 Java가 거부해 더미 1개), `set_weights(w[32], b[1])` L76, `save/restore` L82/L87(`tf.raw_ops.Save/Restore` → SELECT_TF_OPS 필요, 앱에서는 쓰지 않음).
- 출력: `assets/head.tflite`(내장 연산자만, `infer/train/get_weights/set_weights`), `assets/head_ckpt.tflite`(save/restore 포함, flex 필요), `assets/probe_head.txt`(고정 배치 64×32 + 100스텝 뒤 Python 확률 8개 + 손실), SavedModel `data/processed/head_saved`, `head_saved_ckpt`. 내보내기 전 가중치를 0으로 되돌림(L114). `assets/head_features.txt`(32개 이름, med_16 → iqr_16 순)는 생성 스크립트가 없고 수동 작성으로 보인다.
- 프로브 결과: 노트9 100스텝 22.7~44.4ms, 메모리 +0.9~1.3MB, |Δp| 6.0e-8 → PASS(`results/S8_NOTES.md` T11, I20).

### Java: `OnDeviceTrainer.java`
- 상수 `MIN_SAMPLES=50`(미만이면 학습 안 함), `MAX_SAMPLES=2000`(최근 n개 보관), `STEPS=100` L30–32. 과제(arousal/valence)마다 인스턴스 하나.
- 생성자 L42: `assets/head_features.txt` 이름 → `assets/head.tflite` mmap → `readWeights()`로 mu/sd 획득 → 가중치 복원 순서: ① `files/models/student_<task>.txt`(저장본) → ② `assets/student_<task>.txt`(씨앗, `export_daily.py --student`) → ③ 0. 출처는 `source`(files/assets/zero)로 events `student` 이벤트에 기록. (2026-10-25 수정: 이전엔 0으로 시작해 p_student가 항상 0.5였음.)
- `add(x, label)` L97(교사 라벨 표본 보관), `train()` L107(보관 표본 **전체를 한 배치**로 `train` 시그니처 100회 → 마지막 손실, 부족하면 −1), `predict(x)` L129, `readWeights()` L142(`get_weights`, 더미 입력), `restore()` L153(`set_weights`), `save(ctx)` L164 → `files/models/student_<task>.txt`(아래 형식, `%.9g`), `StudentModelText` L181(저장 파일의 w,b만 파싱; mu/sd 줄은 모델 상수와 같다고 가정).
- 학습 주기: `LifeLogService.trainTick()` L410, `TRAIN_MS = 60·60_000`(1시간). 표본 추가는 분 틱 L343–355: 요약 32개 벡터 `xv`에 교사 라벨이 있으면 `trainV.add(xv, lab[0])`(정서가), `trainA.add(xv, lab[1])`(각성). 학습 결과 events `train`(`samples;loss_a;loss_v;ms;steps`).
- 가중치 텍스트 형식(`StudentModel.java` L9–17, `s8_common.write_logistic` L156): 
  ```
  logistic N name_1 … name_N
  mu v…   / sd v…   / w v…   / b v
  ```
  확률 = sigmoid(Σ w_i (x_i−mu_i)/sd_i + b), sd=0→1. 읽기: `StudentModel.java`(앱 전체 로더, 손상 시 IOException), `s8_common.read_logistic()` L166.
- Python 대응물: `s8_common.Student` L129(`sklearn LogisticRegression(C=0.1, class_weight="balanced")` — 단말 GD와 **최적화 방법이 다름**; 형식만 같음), `s7_cumulative.own_model`, `export_daily.student()` L86(씨앗 + `selftest_student.txt`), `s8_student.py`(폰 로그로 재학습, §6).
- 프로브 전용 클래스 `LiteRTProbe.java`(`cmd litert_probe` → `files/litert_probe.txt`, 합격 기준 L103: 100스텝 ≤5s, 메모리 ≤100MB, |Δp| ≤1e-4).

## 5. 성능 가드(DriftGuard)와 접촉 게이트(ContactGate)

### `DriftGuard.java`
- 상수 L14–16: `WINDOW_MS = 14일`, `MIN_N = 15`, `DROP = 0.10`, `RECOVER = 0.05`.
- `score(wallMs, label01, pShip, pStudent)` L30: 팔 B 격자 탭마다 출하·학생을 같은 탭에 채점(정답 = `(p≥0.5)==label`), 14일 롤링 창, n<15면 보류. 학생 활성 중 `student < ship − 0.10` → 출하로 복귀(`guard` 이벤트 `to=ship;n;ship;student`), 비활성 중 `student ≥ ship + 0.05` → 재적용(`to=student`). 히스테리시스로 들락날락 방지(설계 R8/D10).
- 연결: `LifeLogService.setupStage2()` L381 — prefs `student_active`로 상태 영속; `scoreGuard(value)` L428 — `src=ask_B` 탭만, value의 `a`, `pa`(출하 각성), `psa`(학생 각성) 파싱, `a==0` 제외. 활성 모델 선택 L369: `useStudent = guard.studentActive() && !NaN(student)` → 알림·팔 A 트리거·메인 화면에 학생 추정 사용.
- 테스트 `DriftGuardTest`(4). Python 시뮬레이션은 **없음**(`experiments/guard_sim/`은 빈 폴더, 2026-10-30 생성).

### `ContactGate.java`
- `contact(charging, screenOn, stillFrac)` L13: 충전 중 → false; 화면 켜짐 → true; 아니면 `stillFrac < 0.9`(`STILL_MAX`). 비접촉이면 추정 보류(`p=null`), affect 행은 `contact=0`으로 계속 기록(상시 기록 원칙). 연결 `LifeLogService` L337–338.
- Python 검증 `src/s9_contact_rules.py`: `context(pcode)` L47(Screen/Charge/AppUsage 이벤트 → 창 안 비율), 규칙 L78 `contact = charging<0.5 ∧ (screen_on>0 ∨ b2_med_still_frac<0.9)` → `results/s9_contact.csv`(각성 AUROC 접촉 0.624 vs 비접촉 0.591, 보류 18%; I22). CI: `s14_bootstrap.part_c()` → 차이 +0.028 [−0.021, 0.080] 비유의(I28). 테스트 `TeacherContactTest.contactRule`.

## 6. 표정 교사(MediaPipe 블렌드셰이프 → 의사 라벨)

- 표정 추출 `FaceRecorder.java`: CameraX 앞카메라, `assets/face_landmarker.task`(3.7MB), `FACE_FPS=2`(`LifeLogService` L87), 블렌드셰이프 52개만 `face_{ms}.csv`에 기록(영상 미저장). 분 집계 `drainMinute()` L146 → `{frames, faces, smileSum, jawSum}`; smile = `mouthSmileLeft`/`mouthSmileRight` 평균(L138–139), jaw = `jawOpen`(L140).
- 규칙 `TeacherRule.java`: `parse(InputStream)` L26 — `files/models/teacher_params.txt`의 `theta_v`, `theta_a`, `conf_min`(기본 0.3); 둘 중 하나 없으면 IOException → 교사 비활성(라벨 없음). `label(face)` L45: `rate = faces/frames < confMin` → null; `label_v = smile ≥ θv`, `label_a = smile + jaw ≥ θa`(smile·jaw는 얼굴 검출 프레임 평균).
- 현재 임계값 `results/models/teacher_params.txt`: `theta_v 0.0004`, `theta_a 0.0235`, `conf_min 0.3` — 이틀 로그(얼굴 31분)의 70백분위(격자 탭 <20이라 일치율 조정 불가), 2026-10-25 폰 `files/models/`에 push됨(`S8_NOTES.md` 10-25). 앱 시작 로그 events `teacher`(`theta_v=…;theta_a=…;conf_min=…` 또는 `none`).
- Python `src/s8_teacher.py`: `KS=(3,5,7)`, `CONF_MIN=0.3`, `PCT=70`; `choose_threshold(x_at_taps, y01, fallback)` L23(팔 B 탭 ≥20·두 부류면 일치율 최대 θ, 아니면 백분위), `build(affect, taps, k)` L40 → `results/s8_teacher_k{k}.csv`(`t_ns, wall_ms, day, label_v, label_a, conf, tuning_day`), `results/s8_teacher_params.csv`(`k, theta_v, theta_a, how_v, how_a, n_tuning_minutes, n_days, tuning_days, tuning_tap_wall_ms`). 폰용 `teacher_params.txt`는 이 CSV에서 손으로 옮긴다(자동 변환 없음).
- 학생 평가 `src/s8_student.py` `evaluate()` L34: 조정 날(처음 k일)의 교사 라벨(conf≥0.3) 분으로 `Student` 학습(`MIN_TRAIN=30`), k일 이후 팔 B 탭에서 출하/학생/블렌드 AUROC(n≥`MIN_N=20`), 스피어만+원형 순열(`s5_life.circ_perm_p`), held/other 분리, A 부표본, 누락률, 누출 단언(R3) → `results/s8_student.csv`, `s8_student_taps_k{k}.csv`, `results/models/student_{task}_k{k}.txt`. **현재 상태**: 로그가 2일뿐이라 `len(days) <= k`로 모든 k가 조기 반환 → `s8_student.csv`에는 `armB missed` 행 하나만, taps/모델 파일 없음.

## 7. 질문 알림 두 팔(A 급변 / B 무작위)과 로그 형식

### Java
- `AskScheduler.java`(순수 로직, 인터페이스 `Clock/Alarms/Store/Sink`로 주입): `K=3`(하루 B 3회), 창 `09~23시`, `MIN_GAP_B_MS=30분`(B끼리), `MIN_GAP_AB_MS=15분`(A↔B), `ASK_MIN_GAP_MS=30분`(A 연속), `ASK_DELTA=0.25`(각성 추정 변화), `KEY_PLAN="askB.plan"`(prefs, `"dayStartMs:t0,t1,t2"`). `start()` L60(오늘 계획 재등록 또는 새로 뽑기 + 자정 알람 `IDX_MIDNIGHT=99`), `scheduleDay()` L77(events `ask_sched` `arm=B;idx;at;future`), `drawDay()` L90(기각 샘플링), `onAlarm(idx)` L108(A 직후 15분 안이면 `ask_delay`로 15분 미룸), `onEstimate(pa, pv)` L131(**팔 A**: `|pa − askedPa| ≥ 0.25 ∧ 30분 경과 ∧ B 직후 아님`), `fire(arm)` L143 → events `ask` `arm=A|B;pa;pv` + 알림(id 3).
- `AskAlarmReceiver.java`: `ACTION_ALARM = "kr.ac.seoil.motionaffect.ASK_ALARM"`(AlarmManager setExactAndAllowWhileIdle) + `BOOT_COMPLETED` → prefs `life_running`일 때만 `LifeLogService`(`ACTION_ASK_ALARM_SVC`, extra `idx`) 기동.
- `AffectGridActivity.java`(기분 지도): extras `pa, pv, src, psa, psv`; `save()` L186 → value `v=%.3f;a=%.3f;i=%.3f;e=<감정명>;j=<yes|no|빈>;pa=;pv=;src=<ask_A|ask_B|main|overlay>;psa=;psv=` → `LifeLogService.ACTION_AFFECT` → events `affect` + `scoreGuard`. 감정 이름 8개 `NAMES`, 위치 `POS`, 색 함수 `colorAt`(Python 재현 `make_figures._grid_color`).

### 로그 형식 (폰 `files/life/` → PC `data/raw/life/<날짜>/`)
- `events.csv` 열: `t_ns,wall_ms,type,app,media,value` (`t_ns`=elapsedRealtimeNanos, `wall_ms`=벽시계). `type` 목록(`LifeLogService.event()` 호출): `log_start, log_stop, model_load, batch_mode, pending_merged, teacher, student, train, guard, app, media, rate, note, screen_on, screen_off, charge_on, charge_off, affect, ask, ask_sched, ask_delay, sensor_mode, imu_stats, batch_plan_seg, batch_plan_end`. `value`는 `k=v;k=v` 형식(파서 `s8_common.parse_kv` L56, `s12_batch.kv` L17).
- `affect.csv` v3(`AffectRow.java`, `VERSION=3`, 분당 1행, **67열**): `t_ns,wall_ms,minutes,p_arousal,p_valence,minute_us,estimate_us,app` + `v,screen_on,tilt_deg,held,face_frames,face_rate,smile_mean,jaw_mean` + `m_<16>`(분 특징, 키 오름차순) + `s_med_<16>` + `s_iqr_<16>` + `p_student_a,p_student_v,contact`. 헤더가 바뀌면 기존 파일을 `affect_old_<ms>.csv`로 돌린다(L192). v1(8열)은 `affect_v1_<ms>.csv`. `held` = `PostureRule.classify()`(0 flat/1 held/2 other; tilt 15~80°, std 0.01g).
- `imu_<시작ms>.csv.gz`: `t_ns,sensor(a|g),x,y,z`, 약 50Hz, 1시간마다 새 파일(`ROTATE_MS`). 배치 모드면 가속도 `maxReportLatency 300s`, 자이로 해제.
- `face_<시작ms>.csv`: `t_ns,phase,clip,infer_ms,face,bs0..bs51` + `face_<ms>_names.txt`(블렌드셰이프 이름).
- `pending_events.csv`(`PendingEvents.java`): 서비스 꺼진 중 입력 보관, 시작 시 events에 병합.
- 읽는 Python: `s8_common.load_affect()`(v≥2만) / `load_events()` / `grid_taps()`(src→arm A/B/manual), `s5_life.load()`(imu gz 부분 읽기 `read_gz_partial`), `s12_batch.main(path)`.
- 보유 로그: `data/raw/life/2026-10-20/`(S5 파일럿; `events_all/live/test.csv` 변형 포함), `data/raw/life/2026-10-25/`(10-24~25 전체 pull, `affect.csv` 331행), `data/raw/life_archive/2026-10-24_partial/`, `data/life/phone/`(빈 폴더). 골든 발췌 `tests/golden/life/2026-10-20/`(imu 1시간 + 표정 + `events_golden.csv`).

## 8. Android 앱 구조

- 패키지·ID `kr.ac.seoil.motionaffect`, `android/app/build.gradle`: compileSdk 35, minSdk 26, targetSdk 29(Android 10 노트9 고정), Java 17, `abiFilters arm64-v8a`, release는 debug 서명·minify 없음. 의존: `androidx.camera 1.4.2`, `lifecycle-service 2.8.7`, `com.google.mediapipe:tasks-vision 0.10.35`, `org.tensorflow:tensorflow-lite 2.16.1`, `junit 4.13.2`. 루트 `build.gradle` AGP 8.9.1, `gradle.properties`에 `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr`.
- 매니페스트 `app/src/main/AndroidManifest.xml`: **INTERNET 권한 없음**. 권한 FOREGROUND_SERVICE, WAKE_LOCK, CAMERA, PACKAGE_USAGE_STATS, SYSTEM_ALERT_WINDOW, RECEIVE_BOOT_COMPLETED.
- 컴포넌트(`app/src/main/java/kr/ac/seoil/motionaffect/`):
  - `MainActivity`(420줄): 상태 카드·토글 UI + adb 명령 디스패처 `handle()` L217 — `cmd` ∈ `grid, selftest, litert_probe, start(hz|plan,seg_min,tag), batch_on, batch_off, batch_plan(plan,seg_min), life_start, life_stop, viewing(n), stop`.
  - `LifeLogService`(739줄, 핵심): 상시 IMU 기록 + 1분 틱(`DailyEngine`) + 표정 + 앱/미디어 + 격자·좋아/별로 입력 + 2단계(교사·학생·가드) + 3단계(배치 모드 `applySensorMode()` L447, `imuStats()` 5분). 알림 id 2(추정).
  - `SensingService`(224줄): S3 비용 측정 전용(`run_<ms>_<plan>[_tag]_windows.csv` `elapsed_s,hz,n_raw,eff_hz,feat_us,infer_us,prob` / `_system.csv` 배터리·메모리). 알림 id 1.
  - `AffectGridActivity`(기분 지도), `ViewingActivity`(S5 영상 시청 실험), `AskAlarmReceiver`, `MediaListener`(알림 접근 권한용 빈 리스너), `FaceRecorder`, `Ui`(스타일 헬퍼), 로직 클래스 `Features, DailyEngine, TreeModel, StudentModel, ModelFiles(files/models 우선→assets 폴백, events model_load), OnDeviceTrainer, TeacherRule, ContactGate, DriftGuard, AskScheduler, PostureRule, AffectRow, PendingEvents, Fixtures(parseDouble: 'nan'/''/'null'→NaN), LiteRTProbe`.
- SharedPreferences 파일 `"life"`(`AskAlarmReceiver.PREFS`): `life_running`(bool), `askB.plan`, `student_active`, `batch_mode`, `batch_plan`("cont,batch,…"), `batch_seg_min`, UI용 `ui_pa, ui_pv, ui_min, ui_student, ui_at`.
- 인텐트 액션: `kr.ac.seoil.motionaffect.RATE`(extra `value`=like|dislike…), `.AFFECT`(extra `value`), `.ASK_ALARM_SVC`(extra `idx`), `.ASK_ALARM`(수신기), `.OVERLAY`(extra `show`, 패키지 내 브로드캐스트). 시스템 수신: SCREEN_ON/OFF, BATTERY_CHANGED, BOOT_COMPLETED.
- 단말 파일: `/sdcard/Android/data/kr.ac.seoil.motionaffect/files/` — `life/`(§7), `models/`(`daily_*.txt`, `student_*.txt`, `teacher_params.txt` 교체 가능), `selftest_result.txt`, `litert_probe.txt`, `run_*.csv`.
- 빌드(`CLAUDE.md`, `results/S3_NOTES.md`): `JAVA_HOME`=Android Studio jbr, `cd android && ~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`(약 22.5MB, MediaPipe+TFLite 포함). 설치 `adb -s 28115dccf9217ece install -r …`. 단말 Galaxy Note9 SM-N960N, Android 10. 수동 E2E `docs/qa_checklist.md`.

## 9. 테스트

### pytest — `python -m pytest tests` (13개, 수집 확인 2026-10-30)
| 파일 | 함수 | 검증 |
|---|---|---|
| `tests/test_golden.py` | `test_s5_reproduces_golden` | R13: `s5_life.main()`이 `tests/golden/life` 1시간 발췌로 `tests/golden/expected/s5_life_{summary,corr,rates,rate_cmp}.csv`를 rtol 1e-9로 재현(expected 없으면 skip; 현재 있음) |
| | `test_events_parser_golden` | events.csv 열·type 집합 보존 |
| `tests/test_s8_arms.py` | `test_subsample_a_to_b_count` | R1 A를 B 수만큼 부표본 |
| | `test_missed_rate_from_sched_and_fired` | R11 누락률 |
| | `test_row_before_tap_window` | 탭 직전 5분 행 찾기 |
| | `test_logistic_roundtrip` | `Student.write`/`read_logistic` 왕복 1e-12 |
| `tests/test_s8_labels.py` | `test_binarize_rules` | >0/<0/0/NaN |
| | `test_n_gate_blocks_small_samples` | n<20 → 'n 부족' |
| | `test_judge_is_not_a_label_and_arm_parsed` | src→arm, j는 라벨 아님 |
| `tests/test_s8_split.py` | `test_no_leak_between_tuning_and_eval` | R3 합성 로그로 teacher→student 누출 0 |
| | `test_leak_is_detected` | 억지 누출 시 AssertionError |
| `tests/test_stats.py` | `test_r0_equals_spearman_and_shift_direction` | `circ_perm_p` r0=스피어만, FFT 이동 방향(10-23 버그 회귀) |
| | `test_constant_input_gives_nan` | 상수 입력 NaN |

### JUnit 4 — `cd android && gradle testReleaseUnitTest` (31개, `@Test` 집계 2026-10-30; JAVA_HOME=Android Studio jbr, gradle 8.13 캐시본 `~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle`)
| 클래스(`android/app/src/test/java/kr/ac/seoil/motionaffect/`) | 메서드 |
|---|---|
| `AffectRowTest`(2) | `headerAndRowsHaveSameColumnCount_withAndWithoutMissing`, `keysAreSortedAndStable` |
| `AskSchedulerTest`(8) | `drawDay_threeTimesInWindowAtLeast30MinApart`, `start_schedulesThreeFutureAlarmsAndMidnight_andRecordsAskSched`, `restart_sameDay_reusesSavedPlan_noDuplicateAskSched`, `midnightAlarm_drawsNextDayPlan`, `armB_fires_withArmRecorded_andNoEstimateYet`, `armB_postponed15Min_whenArmAFiredJustBefore`, `armA_unchanged_deltaAndGap`, `loadPlan_ignoresOtherDayOrCorrupt` |
| `DriftGuardTest`(4) | `holdsBelowMinN`, `rollsBackThenReappliesWithHysteresis`, `windowDropsOldHits`, `nanProbabilitiesIgnored` |
| `FixturesParseTest`(3) | `nanTokensBecomeNaN`, `numbersParse`, `garbageStillThrows` |
| `PendingEventsTest`(2) | `appendThenDrainKeepsRowsAndDeletesFile`, `drainWithoutFileIsNoop` |
| `PostureRuleTest`(6) | `flatOnDesk`, `heldInHand_screenOn`, `tiltedButScreenOff_isOther`, `proppedUpStill_isOther_notHeld`, `boundaries_15and80deg`, `emptyWindow` |
| `StudentModelFixtureTest`(1) | `seedModelsMatchPythonFixture`(assets 경로를 `src/main/assets` 또는 `app/src/main/assets`에서 찾음) |
| `StudentModelTest`(2) | `predictMatchesStandardizedLogistic`, `corruptFilesThrowIOException_notCrashLater` |
| `TeacherContactTest`(3) | `teacherParsesAndLabels`, `teacherRejectsMissingThresholds`, `contactRule` |

합계 13 + 31 = 44 (기대치와 일치). 기기 selftest(§2)와 `docs/qa_checklist.md`는 별도 수동 검증.

## 10. 실험 스크립트 한 줄씩

| 스크립트 | 목적 | 입력 | 출력 | 노트 |
|---|---|---|---|---|
| `src/features.py` | StudentLife PAM 라벨 + EMA 직전 30/60/120분 활동추론·폰잠금 특징 (`build()`) | `data/raw/dataset_rds/{EMA/PAM.Rds, sensing/activity.Rds, phonelock.Rds}` (pyreadr) | `data/processed/pam_features.parquet`(9,040×33) | S1 |
| `src/s1_affect.py` | S1: OS 활동 범주로 정서가/각성 LOSO·개인화(pers) | `pam_features.parquet` | `results/s1_affect.csv` | `results/S1_NOTES.md` |
| `src/s1b_wesad.py` | S1b: WESAD 손목 32Hz 스트레스, 해상도 곡선, 방향무관·생리 참조; **raw_feats 정의 파일** | `data/raw/WESAD/S*/S*.pkl` | `data/processed/wesad_windows.parquet`(2,061×132), `results/s1b_wesad.csv` | `S1B_NOTES.md`(`s1b_wesad_still/tasks.csv`는 노트에만 있고 생성 코드 없음) |
| `src/export_model.py` | S3 준비: WESAD 2/8/16/32Hz 트리 200개 → 앱 assets + selftest 픽스처 (`flatten` 형식 정의) | `wesad_windows.parquet`, S2.pkl | `assets/model{fs}.txt`, `selftest{fs}.txt` | `S3_NOTES.md` |
| `src/s4_kemophone.py` | S4: K-EmoPhone 모션 수준(OS/세기/3범주/raw 2·4·8Hz)별 LOSO; ESM 특징 parquet 생성 | `data/raw/kemophone/*.zip` | `kemophone_esm_features.parquet`, `results/s4_kemophone.csv` | `S4_NOTES.md`(`s4_kemophone_bootstrap.csv` 생성 코드 없음, `make_figures`가 읽음) |
| `src/s4b_personality.py` | S4b: 사용자별 AUROC ↔ Big Five·PSS·PHQ 스피어만 | esm parquet, `SubjData.zip/UserInfo.csv` | `results/s4b_personality.csv` | I5 |
| `src/s5_life.py` | S5: 1인 일상 기록(IMU·표정·좋아/별로) 1초 정합, 원형 순열 상관(`circ_perm_p` L92), 곡 단위 좋아/별로 비교. 환경변수 `MA_LIFE_RAW`, `MA_RESULTS` | `data/raw/life/*/{imu_*.csv.gz, face_*.csv, events_*.csv}` | `results/s5_life_{summary,corr,rates,rate_cmp}.csv` | `S5_NOTES.md`, 골든 테스트 대상 |
| `src/s6_build_2hz.py` | S6 준비: 단말 재현 가능한 블록 평균 2Hz 특징 parquet | `kemophone/P*.zip`, s4.ESM | `kemophone_2hz_block.parquet` | `S6_NOTES.md` |
| `src/s6_params.py` | S6: 단변량 AUROC/사용자 내 ρ, 중첩 전진 선택, 개인 기준선 z, 트리×잎 크기 격자 (`SMALL` 100×7 기준) | esm parquet(raw2_, coarse_) | `results/s6_{univariate,selection,selection_auc,baseline,model_size}.csv` | `S6_NOTES.md`(`s6_block2hz/bootstrap/univariate_block.csv` 생성 코드 없음) |
| `src/export_daily.py` | 단말 배포: 각성·정서가 트리 50×3 + `selftest_daily.txt`; `--student`로 학생 씨앗 로지스틱 + `selftest_student.txt` | `kemophone_2hz_block.parquet`, P*.zip | `assets/daily_*.txt`, `selftest_daily.txt`, `student_*.txt`, `selftest_student.txt` | `S6_NOTES.md`, `S8_NOTES.md` T4 |
| `src/s7_cumulative.py` | S7: 자기 응답 k개(0~30) 누적 시 base/own/blend AUROC(전체·사용자별); **DEPLOY·load·base_loso·own_model 정의** | 2hz_block | `results/s7_cumulative.csv`, `s7_log.txt`, (`s7_stdout.txt` 수동 리다이렉트) | I9 |
| `src/s8_common.py` | S8 공용: 폰 로그 읽기, 격자 탭 파싱·이진화, 팔 처리, `Student` 모델·텍스트 형식 | `data/raw/life/*/` | — | 테스트 대상 |
| `src/s8_teacher.py` | S8 교사: 표정 분 집계 → 의사 라벨, k일 조정 | affect/events | `results/s8_teacher_k{3,5,7}.csv`, `s8_teacher_params.csv` | `S8_NOTES.md` |
| `src/s8_student.py` | S8 학생: 교사 라벨로 학생 학습, 팔 B 탭 평가(1단계 게이트) | 위 + affect | `results/s8_student.csv`, `s8_student_taps_k*.csv`, `results/models/student_*_k*.txt` | 현재 'n 부족'·조기 반환 |
| `src/s9_contact_rules.py` | S9: 접촉 게이트 규칙을 K-EmoPhone 폰 맥락으로 검증 | 2hz_block, P*.zip(Screen/Charge/App) | `results/s9_contact.csv` | `S9_NOTES.md`, I22 |
| `src/s10_external.py` | S10: Empatica E4 `ACC.csv`(간호사 스트레스) 로더, 5분 창 2Hz 요약+32Hz 특징 | `data/raw/nurse/**/ACC.csv`(**없음**) | `data/processed/nurse_windows.parquet`(미생성) | 【미검증】 데이터 미입수, DAPPER 미구현 |
| `src/s11_identity_probe.py` | S11: 32특징으로 77명 신원 식별(top-1/5, 다수결), 라벨 섞기 대조, 정서 서명 코사인 | 2hz_block | `results/s11_identity.csv` | `S11_NOTES.md`, I20·I21(누출 교훈) |
| `src/s12_batch.py` | S12: 배치 ABAB 전력 실험 분석(`batch_plan_seg`, `imu_stats`) | `data/raw/life/2026-10-25/life/events.csv`(인수) | `results/s12_batch_{segments,windows}.csv`, `s12_batch_log.txt` | `S12_NOTES.md`(통제 실패) |
| `src/s13_window.py` | S13: 요약 창 길이 1~60분 비교(LOSO 50×3) + window_sweep parquet 생성 | P*.zip → `kemophone_window_sweep.parquet` | `results/s13_window.csv`, `s13_window_log.txt` | `S13_NOTES.md`, I24 |
| `src/s14_bootstrap.py` | S14: 참가자 부트스트랩 1,000회 95% CI(A 창 길이, B 누적 k=30, C 접촉, D 식별 Wilson, E 시드 안정성); OOF 캐시; 노트 자동 생성 | window_sweep, 2hz_block, `s11_identity.csv`, s9.context | `results/s14_bootstrap.csv`, `results/S14_NOTES.md`(**스크립트가 덮어씀**), `data/processed/s14_*.parquet` | I28 |
| `src/s15_selection_bias.py` | S15: 급변(A) 표본 vs 무작위(B) 표본 평가 편향(δ 0.10~0.25), 환경변수 `S15_MIN_N` | 2hz_block | `results/s15_selection_bias_min{20,10}.csv`, `*_log.txt` | `S15_NOTES.md`, I26 |
| `src/s16_offset_baseline.py` | S16: base/blend/offset(수준 보정만) 전체 AUROC k=10·20·30 | 2hz_block | `results/s16_offset_baseline.csv`, `s16_offset_log.txt` | `S16_NOTES.md`, I25 |
| `src/s17_label_sensitivity.py` | S17: 사용자 중앙값 기준 라벨 민감도 | 2hz_block | `results/s17_label_sensitivity.csv`, `s17_label_log.txt` | `S17_NOTES.md`, I27 |
| `src/s17b_zero_excluded.py` | S17b: 0 응답 제외 이진화 | 2hz_block | `results/s17b_zero_excluded.csv` | `S18_NOTES.md`, I30 |
| `src/s18_baselines.py` | S18: base/prior/carry/hour/offset/feat1/own32/blend/base+hour 공정 비교, 사용자 부트스트랩 500회 | 2hz_block | `results/s18_baselines.csv` | `S18_NOTES.md`, I29 |
| `src/train_head.py` | LiteRT 학생 헤드 변환 + 프로브 픽스처 (§4) | 2hz_block | `assets/head*.tflite`, `probe_head.txt` | `S8_NOTES.md` T11 |
| `src/make_figures.py` | 논문 그림: `resolution_curve, wild_bars, system_diagram, loop_diagram, s7_chart, app_example, screens` | `results/*.csv`, `paper/figures/shots/*.png` | `paper/figures/fig_*.png` | 폰트 Malgun Gothic 고정 |
| `src/build_paper_docx.py` | IAAI 2026 docx 생성(템플릿 `../Creative/paper/국제인공지능학회 학술대회 논문_강정모_수정본.docx`, 본문 하드코딩) | `paper/figures/*.png` | `paper/MotionAngry_IAAI2026_강정모_v2.docx` | 저장소 밖 템플릿 의존 |
| `esp32/gen_weights.py` | `assets/student_*.txt` → `esp32/student_weights.h` | assets | `student_weights.h` | T16 |

`results/*_stdout.txt`(s7, s9, s13, s14, s15, s16, s17, s17b, s18)는 콘솔 출력을 수동으로 리다이렉트한 파일이다.

## 11. 논문·문서·그림

### `paper/`
| 파일 | 역할 |
|---|---|
| `main_ko.md` | 1차 논문(IAAI 2026) 한글 원고 본문 — "움직임 신호의 정서 정보는 어디에 있는가"(해상도·일상·단말 구현) |
| `IAAI2026_원고_HWP용.md` | 같은 논문의 HWP 양식 삽입용(10-24 제출판, 표 6·7시간 파일럿 반영) |
| `MotionAngry_IAAI2026_강정모.docx`, `_v2.docx` | `build_paper_docx.py` 산출(제출본) |
| `학술대회2_온디바이스_자기학습_원고.md` | 2차 학술대회 원고(온디바이스 자기 학습 루프: S7·S9·S11·T11·기기 동작·ESP32), 10-30 저자 HWP 수정판 반영 |
| `kr/manuscript.md` | 위 2차 원고와 **바이트 동일 복사본**(2026-10-30 17:02 생성) |
| `KCI_원고_초안.md` | KCI/SCI 확장 원고 초안(제안서 겸, 【미실시】 표시; S14~S18·문헌 49건 반영) |
| `sci/` | 빈 폴더(영문 SCI 초안 예정지) |
| `figures/` | `fig_resolution.png`(그림2 해상도·강도 통제), `fig_wild.png`(K-EmoPhone CI 막대), `fig_system.png`(1차 논문 그림1), `fig_loop.png`(2차 논문 그림1 재귀 루프), `fig_s7.png`(누적 k 곡선), `fig_app.png`(격자+B 예약), `fig_screens.png`(실기기 캡처 합성), `shots/01_main.png, 02_grid.png`, `shots_before/` |
| `refs/*_해석.md` | 참고문헌 6편 해석(Aldenhoven ARKit, Hosseini 간호사 E4, Kang K-EmoPhone, LiteRT 가이드, Lugaresi MediaPipe, Russell Affect Grid); PDF/HTML은 git 무시 |

### `docs/`
| 파일 | 역할 |
|---|---|
| `designs/motionangry-ondevice-loop.md`(981줄) | 설계 문서 + 엔지니어링 리뷰(10-24): 결정 원장 R1~R13, 질문 D1~D18, 구현 과제 T1~T18 체크리스트(T12 동의 화면만 미완) |
| `evolve_loop.md` | 앱↔분석↔논문 공진화 기록, 문제 정의 v1~v3, **인사이트 장부 I1~I30**(지우지 않고 상태만 변경) |
| `STATE.md`, `RESEARCH_LOG.md` | 2026-10-30 48시간 자율 연구 세션의 단일 진실·로그(Phase 0~8) |
| `reviewer_critique_2026-10-30.md` | SCI 리뷰어 관점 심사 M1~M12 |
| `sci_roadmap_2026-10-30.md` | 보강 결과 요약 + Major 지적 상태표 + 다음 단계 |
| `lit_review_2026-10-30.md`(49건), `related_work_search.md`, `search_queries.md`, `ref_review_*.md`(참고 PDF 3묶음 정독표) | 문헌 |
| `qa_checklist.md` | 기기 수동 E2E 7항목(1·2·4 통과, 3·5·6 미수행) |
| `pilot_content_design.md` | S5 파일럿 설계 |
| `kemophone_access_request.md`, `idea_notes.md` | 기타 |
| 루트 `CLAUDE.md` | 테스트 명령·규칙(상시 기록 원칙, 【미실시】 표기, 장부 불삭제) |
| 루트 `TODOS.md` | 미착수 3건(K-EmoPhone HR/EDA 생리 기준, 원시 손목 신원 재검, 비트 동조 지수) |
| 루트 `RESEARCH_PLAN.md`, `PAPER_GUIDE.md` | 초기 계획, 논문 작성 지침 |

### `results/S*_NOTES.md`
S1, S1B, S3(단말 측정·배터리 실패 기록), S4, S5, S6, S8(구현 일지 T1~T18·10-25·UI), S9, S11, S12, S13, S14(스크립트 생성), S15, S16, S17, S18. S2·S7·S10 노트는 없다(S7은 `s7_log.txt`, S10은 데이터 없음).

## 12. 알려진 함정(코드 주석·노트에서 수집)

1. **adb 경로 변환**: Git Bash에서 `adb pull /sdcard/...`는 MSYS가 경로를 바꾼다 → `MSYS_NO_PATHCONV=1` 접두(`results/S3_NOTES.md` L6). 에뮬레이터가 함께 뜰 수 있어 항상 `adb -s 28115dccf9217ece`. cwd가 `android/`로 바뀐 상태에서 상대 경로 pull을 하면 엉뚱한 곳에 저장됨 → 절대 경로(`S8_NOTES.md` T4~T8 주의).
2. **안드로이드는 요청 샘플링 빈도를 보장하지 않음**: 2Hz 요청해도 다른 앱이 50Hz로 잡고 있으면 50Hz 수신(I13, `S3_NOTES.md` 10-20). 저빈도 전력 이점은 센서 HW FIFO 배치로만 — 배치 ABAB 실험은 통제 실패(S12). windows CSV의 `eff_hz`를 항상 확인.
3. **LiteRT 변환**: `tf.GradientTape` 자동 미분은 `BroadcastGradientArgs`(비내장 연산자)를 만들어 `TFLITE_BUILTINS` 변환 실패 → 로지스틱 기울기를 닫힌 식으로 작성(`train_head.py` L56). `Save/Restore`는 SELECT_TF_OPS(flex 위임) 필요 → 앱은 `get_weights/set_weights`로 텍스트 체크포인트 대체. TFLite Java `runSignature`는 빈 입력 맵을 거부 → 입력 없는 시그니처에 더미 입력(`get_weights(dummy)`). 내보내기 전 가중치를 0으로 되돌려야 Python 기준과 비교 가능(처음엔 0.064 차이).
4. **학생 씨앗 결함(수정됨 10-25)**: 저장 파일 없을 때 0 가중치로 시작 → 첫 저장이 0을 덮어 p_student 항상 0.5. 지금은 assets 씨앗 복원 + `source` 기록. 폰에 남은 0 가중치 `student_*.txt`는 삭제해야 함.
5. **접촉 게이트와 충전**: USB 연결(충전) 중엔 `contact=0`으로 추정이 보류되는 것이 정상 동작 — 디버깅 중 "추정이 안 나온다"는 대부분 이것.
6. **교사 비활성**: `files/models/teacher_params.txt`가 없으면 교사가 꺼져 학생 표본이 쌓이지 않음(events `teacher none`). 학습은 표본 ≥50일 때만 1시간 틱에서.
7. **affect.csv 헤더 변경**: 열이 바뀌면 서비스가 기존 파일을 `affect_old_<ms>.csv`로 돌리므로 분석 시 여러 파일을 합쳐야 한다(`s8_common.load_affect`는 `affect*.csv`를 전부 읽고 `v>=2`만 사용).
8. **S11 라벨 누출**: 검증 창을 정답 사용자 통계로 정규화하면 트리가 87%를 냄(누출 산물). 라벨 섞기 대조군으로 잡음(I21, `s11_identity_probe.py` L119 주석).
9. **순열 검정 FFT 방향 버그(10-23 수정)**: `circ_perm_p`의 상관 인덱스가 `np.roll(y, s)`와 같은 방향인지 `test_stats.py`가 고정.
10. **`s4_kemophone` import 부작용**: 모듈 import만으로 `SubjData.zip`을 읽는다(§1). 데이터 없는 머신에서는 `s6_build_2hz`, `s9`, `s13`, `export_daily`, `s4b`, `s14(part_c)` import가 실패.
11. **`s14_bootstrap.py`는 `results/S14_NOTES.md`를 덮어쓴다**(`write_notes`). 손으로 고친 내용은 사라짐.
12. **Windows 콘솔 한글 깨짐**: s14 이후 스크립트는 콘솔을 숫자 위주로, 파일은 `encoding="utf-8"`로 쓴다. 다른 스크립트의 `to_csv`는 기본 인코딩(현재 환경 cp949일 수 있음)이라 한글 열 값(`note` 'n 부족' 등)은 읽을 때 인코딩 확인.
13. **그림 폰트**: `make_figures.py`는 `font.family="Malgun Gothic"` 고정 — 윈도우 외 환경에서는 한글이 깨진다. `savefig` OSError는 코드·노트에 기록된 사례가 없다(경로 `paper/figures/`는 `mkdir(exist_ok=True)`로 보장).
14. **생성 코드가 없는 결과 CSV**: `results/s1b_wesad_still.csv`, `s1b_wesad_tasks.csv`, `s4_kemophone_bootstrap.csv`, `s6_block2hz.csv`, `s6_bootstrap.csv`, `s6_univariate_block.csv`는 노트와 `make_figures.py`(`resolution_curve`, `wild_bars`)가 참조하지만 `src/`에 만드는 코드가 없다(일회성 세션 코드로 추정). 재생성이 필요하면 노트의 설명으로 복원해야 한다.
15. **저장소 밖 의존**: `build_paper_docx.py`의 템플릿은 `D:\Projects\Documents\Creative\paper\…docx`(존재 확인됨, 저장소 밖). `s10_external.py`의 `data/raw/nurse/`는 없음.
16. **gradle**: 래퍼 스크립트가 없어 캐시본 gradle 8.13 바이너리를 직접 호출해야 하며, `gradle.properties`의 `org.gradle.java.home`이 Android Studio jbr 절대 경로를 가리킨다(다른 PC에서는 수정 필요). `android/local.properties`는 git 무시.
17. **MediaPipe 미디어 제목**: 유튜브 앱 내 재생은 미디어 세션 메타데이터를 비워 곡·영상 제목이 기록되지 않는다(멜론은 됨) — 앱 이름·시간으로만 연결(`S3_NOTES.md` 10-20).

## 13. 빠른 시작 순서(새 PC)

1. Python 3.11 + `pip install -r requirements-research.txt` (TensorFlow는 `train_head.py`에만 필요).
2. `data/raw/kemophone/`에 P*.zip·SubjData.zip, `data/raw/WESAD/`(선택), `data/raw/life/<날짜>/`(폰 로그) 배치.
3. `python src/s6_build_2hz.py` → `kemophone_2hz_block.parquet`; 그 다음 `s7_cumulative.py` 등. `s13_window.py`는 window_sweep을 스스로 만든다.
4. `python -m pytest tests` (13).
5. 앱: Android Studio jbr를 JAVA_HOME으로, `cd android && <gradle 8.13>/bin/gradle testReleaseUnitTest assembleRelease` (31).
6. 폰 선순환 점검: `am start … --es cmd life_start` → events `teacher`/`student`/`model_load` 확인 → 로그 pull → `python src/s8_teacher.py && python src/s8_student.py`.
