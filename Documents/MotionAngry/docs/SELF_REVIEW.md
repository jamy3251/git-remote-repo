# SELF_REVIEW — IEEE Access 투고 전 3인 심사 (2026-10-30, 대상 `paper/sci/main.md` v0.2)

심사자: 방법론(M), 시스템(S), 통계(T). 수치 감사는 `results/` 원본 CSV·로그를 직접 열어 대조했다(Abstract, 5장, 6장 전부). 원고는 수정하지 않았다.

읽은 자료: main.md, docs/PREREG.md, results/loop_sim/{LOOP_SIM_NOTES.md, summary.csv(21:53 재생성본), rq4_selection.csv, rq4_selection_log.txt, rq4_run.log}, results/benchmark/{BENCHMARK_NOTES.md, summary.csv, benchmark_log.txt}, results/guard_sim/{guard_sim.csv, guard_sim_log.txt}, results/privacy/{PRIVACY_NOTES.md, reident.csv, weight_leak.csv}, results/field/power.csv + experiments/field/power.py, results/system/{scaling_pc.csv, minute_timing.csv}, data/raw/life/2026-10-25/{litert_probe.txt, events.csv}, results/{S8,S12,S14}_NOTES.md, s9_contact.csv, s13_window.csv, teacher/teacher_validity_log.txt, docs/{LOOP_SIM_README.md, ASSUMPTIONS.md, REPO_MAP.md, reviewer_critique_2026-10-30.md}, paper/sci/related_work_gaps.md, experiments/{loop_sim/sim.py, loop_sim/rq4_selection.py, guard_sim/guard_sim.py, common/eval.py, privacy/weight_leak.py}, tests/test_loop_sim.py, android 소스(DriftGuard, AskScheduler, ContactGate, OnDeviceTrainer, LifeLogService, build.gradle, AndroidManifest), figures/*.png + make_figures.py, data/processed/kemophone_2hz_block.parquet(사용자별 응답 수·기간 재계산).

---

## 0. 수치 감사 결과 요약

대조한 수치 약 180개 중 **원본과 다른 것 1건(대형), 표·본문·초록 사이 불일치 6건, 출처 파일이 없는 수치 2건**. 나머지(Table 1·3 전부, 6.1 본문, 6.3 본문, 6.5 전부, 6.6 단말 측정, 4.4, 5.1, 5.2 사용자 수, Table 2의 within-user 열과 CI 열, 오라클 0.514/0.567, 가드 활성 52~60 %·전환 0.6~0.7, 교사 분 ~650, 교사 타당성 360/31/3/0)는 원본과 일치한다.

| 수치 | 원고 | 원본 | 판정 |
|---|---|---|---|
| 6.4 팔 A 발화율·수치 전부 (8.5 %, 322, 1.36×, 0.15→1/3·−0.022, q75=0.174·−0.030, −0.016 [−0.063, +0.029], 정서가 2.4 %) | rq4_selection.csv·rq4_selection_log.txt를 인용 | **인용된 두 파일에는 다른 정의(consecutive)의 결과가 들어 있다**: 0.25에서 A=1, 0.15에서 A=6, q75=0.056(25 %)·−0.054 [−0.091, −0.016]. 원고 수치는 `rq4_run.log`(since_last_ask 정의)에만 있다. 그림 6은 CSV로 그려져 본문과 모순 | **[수치 불일치]** 출처 파일 교체·재생성 필요 |
| Table 2 pooled 열 (student 0.648/0.696, guard 0.650/0.706, anchor 0.722) | 캡션 "three-seed means" | 3-seed 평균은 0.647/0.703, 0.662/0.715, 0.719/0.765. 표 값은 seed 0 값 | [수치 불일치] 캡션 또는 값 중 하나 수정 |
| 6.2 "pooled AUROC rises from 0.617 to between 0.648 and 0.768"; Abstract "0.62 to 0.65 to 0.77" | | 0.617은 각성 base, 0.768은 정서가 student_a1.0(표에 없음). 각성 0.617→0.634~0.732, 정서가 0.586→0.668~0.768 | [불일치] 과제별로 분리 |
| 6.3 "results at 0.55 and 0.65 are the same to two digits" | | q0=0.65: 고정 임계 28일 오복귀 0.669(vs 0.681), 베이즈 0.141(vs 0.152), 베이즈 지연 13.3일(vs 13.7) | [불일치] "within 0.02"로 |
| Abstract "7 % (5.4×) under linear and non-linear attackers" | | 비선형은 2.7 %·5.2 % (더 낮음) | [불일치] "at most 7 %" |
| 6.2 "four valence cells … significantly negative" vs 그림 2 | 본문은 4셀 유의 | 그림 2 기준(Wilcoxon p<0.05 in ≥2 seeds)으로는 별표 0개; 4셀은 seed 0 참가자 부트스트랩 CI 기준(Wilcoxon은 셀당 1 seed만 p<0.05) | [불일치] 기준 명시·그림 기준 통일 |
| 6.2 "slightly better at the lower density" | 일반 진술 | 각성만(0.528 vs 0.519); 정서가는 반대(0.539 vs 0.559) | [불일치] 각성 한정 |
| 6.4 "median minute-to-minute change 0.036, maximum 0.26" | 출처 없음 | ASSUMPTIONS A8·노트에만 있고 results/ 파일 없음 | [출처 없음] |
| 5.1 "period 1.4 to 6.5 days, median 6.3; 10 to 101 responses, median 49" | 출처 없음 | parquet 재계산 1.44/6.34/6.50, 10/49/101 일치 | 값은 맞음, 출처 스크립트 명시 |
| 6.6 "a model one hundred times larger … would still fit in a few seconds per hour" | PC 1.47 s 근거 | 같은 프로브(64×100스텝)가 PC 0.36 ms, 폰 22.7~44.4 ms → 폰은 60~120× 느림 → 3,300파라미터·2,000배치는 폰에서 약 1.5~3분/시간 | [과장] 폰 환산값으로 |
| 8장 "20 participants … to detect 0.10" | power.csv | 현장 보정(A10, σ_d×√(21/59)) Wilcoxon 검정력 0.8: 학생 18·가드 13·앵커 11; 검정력 0.9: 24/17/14. **무보정**: 50/32/26 | [조건 누락] 보정 가정과 무보정 값 병기 |
| Table 2 오라클 행 Δ 공란 | | CSV에 있음: 각성 −0.124 [−0.177, −0.071], 정서가 −0.060 [−0.113, −0.008] | 채울 것 |
| 5.2 "the only learner change we tested" (앵커) | | summary.csv에 bias-only 학생(student_bias/esm_bias) 결과가 있음: 각성 0.603(−0.037 [−0.059, −0.015]) / pooled 0.714, 정서가 0.588(−0.041 [−0.070, −0.013]) / 0.760 | [미보고 결과] 7장 권고 (ii)와 직결 |
| Table 2 base 0.638 vs Table 1 base 0.623 | 설명 없음 | 같은 모델, 다른 집합(65명·뒤 40 % 응답 vs 72명·전체) | 캡션에 한 줄 |
| 5.2 "51 cells" vs Abstract·C2 "32 cells" | | 51 = 48 격자 실행 + 3 오라클(seed 포함), 32 = 16 (p,d,b) × 2 과제 | 용어 통일 |

---

## 1. 지적 사항 표

심각도: Major = 심사자가 수정 없이는 게재 불가로 볼 것, Minor = 문장·표 수정으로 해결.

| 번호 | 심사자 | 심각도 | 위치 | 문제 | 수정 제안 | 즉시 수정 가능 |
|---|---|---|---|---|---|---|
| 1 | M/S/T | Major | 6.4, 그림 6, LOOP_SIM_NOTES | 본문 수치는 `rq4_run.log`(since_last_ask)이고 인용 파일 `rq4_selection.csv/_log.txt`와 그림 6은 consecutive 정의 결과(0.25에서 A=1, q75=0.056). "every number cites its output file"(C5)이 이 절에서 깨진다. 리뷰어가 CSV를 열면 바로 드러남 | `RQ4_DEF=since_last_ask python experiments/loop_sim/rq4_selection.py` 재실행(코드 기본값이 since_last_ask이므로 환경변수 없이도 됨) → CSV·로그·그림 6 재생성. 보조 정의는 `rq4_selection_consecutive.csv`로 분리 저장하고 본문의 "almost never fires" 문장이 그 파일을 가리키게 | 예 |
| 2 | M | Major | 5.2, 6.2, 7장 | 시뮬레이터는 **새 표본이 없어도 매 정시 100스텝**을 돈다(sim.py `while hi < len(hours)`: 버퍼는 응답 때만 바뀜). 6일 ≈ 144회 × 100 = 14,400스텝을 ≤2,000개(실질적으로 응답 49건의 30분 복제본)에 반복 → "2일째 급락"의 유력 기전. 단말은 화면 켜진 매 분 새 표본이 들어오므로 조건이 다르다. 원고는 이를 적지 않고 "hourly update over-fits"를 학습식 자체의 성질로 서술 | (a) 5.2에 "학습 호출은 새 표본 유무와 무관하게 매 정시" 명시, (b) 7장 "level over-fit" 설명에 복제 라벨(유효 n≈49)과 반복 호출을 원인 후보로 추가, (c) 가능하면 `새 표본 ≥1일 때만 학습` 변형 1셀(p=0.8,d=0.5) 추가 실행 — sim.py 3줄 | (a)(b) 예, (c) 아니오(재실행 수 분~수십 분) |
| 3 | M | Major | Abstract, C2, 7장, 9장 | "no on-device update, including an oracle teacher, raises within-user AUROC"는 학습식 일반에 대한 주장으로 읽힌다. 검증한 것은 (i) 비정규 full-batch GD, (ii) L2 앵커, (iii) bias-only, (iv) sklearn L2, (v) Platt 5가지. 오라클은 '잡음 0'일 뿐 ESM과 같은 정보(라벨 복사)라 "완벽한 교사도 못 한다"가 아니라 "같은 정보를 30배 복제해도 못 한다"가 정확 | "no update rule we tested (full-batch GD with or without L2 anchor, bias-only, L2 logistic, Platt), even with noise-free copies of the self-report labels" 식으로 범위 한정. 오라클 명칭을 "noise-free label-copy teacher"로 | 예 |
| 4 | M | Major | 5.2 "(d′) … the only learner change we tested", 7장 (ii) | summary.csv에 bias-only 학생(w 고정, b만 갱신) 결과가 이미 있다: 각성 0.603, 정서가 0.588, 모두 base 아래(CI 0 제외). 7장은 "bias-only update whose level component is applied as calibration"을 미검증 해법으로 권고하는데, 검증된 결과는 **bias만 바꿔도 within-user가 0.03~0.04 떨어진다**(시변 절편이 시점 간 순위를 바꾸기 때문)는 것 | Table 2에 bias-only 행 추가(모든 갱신 중 가장 덜 나쁨, 그래도 base 아래), 7장 (ii)를 "a frozen-ordering learner still loses 0.03–0.04 because the level estimate itself wanders within the week; the level must be applied with a lag or shrinkage"로 고쳐 결과와 맞춤. 5.2 문장 수정 | 예 |
| 5 | M | Major | 2.4, 6.4 | 2.4가 "use [IPW] to quantify how far model-triggered responses depart"라고 약속하지만 6.4에 IPW 결과가 없다(rq4_run.log에는 있음: IPW pooled 0.631/0.603/0.597). related_work_gaps.md 5항과 동일 약속 | 6.4에 IPW 보정 pooled AUROC 한 문장 추가(0.25: 0.631, 0.15: 0.603, q75: 0.597 — 보정 후에도 임계에 따라 ±0.03 흔들림) 또는 2.4의 약속 삭제 | 예 |
| 6 | M | Major | related_work_gaps.md ↔ main.md | gaps 문서가 약속하고 원고가 못 준 것: (2) "reports the (p,d) region in which the student matches or exceeds" + "how much density would be required" — 영역이 비어 있고 필요 밀도 추정 없음; (3) "leaving within-user discrimination unchanged" — 실제로는 감소; (6) "number of self-reports per day the face teacher substitutes for" — 없음; (7) "attribute and membership information recoverable from the 33 weights" — 신원 매칭만 했고 membership inference 없음; (8) "specifies the teacher accuracy, density and guard sample size needed" — p*가 없으므로 불가 | gaps 문서를 결과에 맞게 갱신(2·6·8은 "region is empty at this volume", 3은 "decreased", 7은 "identity matching only; membership inference 【미실시】). main.md 2.3 "map the region where self-training helps" → "map whether such a region exists" | 예 |
| 7 | S | Major | C1, 4.3, 6.6, 7장 | 단말 events.csv의 모든 `train` 이벤트가 `samples=0; steps=0`이다. 실제 교사 라벨로 돌아간 단말 학습은 0회(얼굴 검출 31분 < 시간당 50표본). "a LiteRT student trained hourly on the device"(Abstract·C1)는 구현·프로브 통과를 뜻할 뿐 실가동 증거가 아니다 | C1·6.6에 "the hourly trainer has executed only on the synthetic probe; on the author's log no hour reached the 50-sample threshold" 명시. 7장 RQ5 문단에 합치기 | 예 |
| 8 | S | Major | C5, 9장, 전체 | 저장소가 비공개(origin jamy3251/git-remote-repo, critique M11). IEEE Access 심사자는 "All experiments are scripts in the repository"를 보면 링크를 요구한다. 또 `data/processed/loop_*`·`results/*.csv`·응답 ID 목록·probe_head.txt가 있어야 재현된다 | 공개 저장소 + Zenodo DOI(또는 "available at review via anonymous link"), 응답 3,771건 (pcode, t) 목록과 results/ CSV 포함. 가능하면 투고 전 | 아니오(저장소 작업) |
| 9 | T | Major | 8장, results/field/power.csv | "20 participants, four weeks, δ=0.10"은 (a) σ_d를 √(21/59)로 줄인 A10 가정(사용자별 AUROC 분산 전부가 표본 잡음이라는 가정; 실제 효과 이질성은 응답 수로 줄지 않음), (b) 가장 유리한 조건(가드·앵커), (c) 관찰된 어떤 효과보다 큰 δ에서만 성립. 무보정 Wilcoxon n은 학생 50·가드 32·앵커 26. δ=0.05면 보정 37~71, 무보정 103~198 | 8장에 "17–24 under the response-count adjustment (A10), 26–50 without it; a 0.05 gain needs 40–70 / 100–200" 병기, A10 가정을 문장으로 | 예 |
| 10 | T | Major | 6.2, 그림 2, PREREG | H2 "rejected"는 부적절: 각성 16셀 모두 학생−ESM CI가 0을 포함(상한 최대 +0.082), 유의 양성 없음 = "not supported", 기각 아님. 반면 **학생 < base는 각성 전 셀에서 CI 상한 ≤ −0.016**으로 강한 결론. 또 "4 valence cells significantly negative"의 기준(seed 0 CI)과 그림 2 별표 기준(≥2 seeds Wilcoxon)이 달라 그림엔 별표가 없다 | "H2 is not supported (no cell positive; upper CI bounds ≤ +0.08 vs ESM fine-tune), while the student is below the population model in every arousal cell (upper bounds ≤ −0.016)"로. 그림 2 별표 기준을 본문 기준(seed-0 participant-bootstrap CI excludes 0)으로 통일하거나 본문에 그림 기준 명시 | 예 |
| 11 | T | Minor | Table 2 캡션, 5.3 | 점추정은 3-seed 평균, CI는 seed 0 — 혼합. seed 간 차이는 작지만(학생 0.516~0.520) 심사자가 지적할 것. pooled 열은 seed 0 값인데 캡션은 3-seed | 사용자별 AUROC를 3 seed 평균한 뒤 참가자 부트스트랩(sim.py summarize 수정, 수 초) 또는 캡션을 "point estimates: 3-seed mean; CIs and pooled AUROC: seed 0"로 | 캡션 예 / 재계산 아니오(코드 10줄) |
| 12 | T | Minor | 5.3, 6.2 | 32셀 × Wilcoxon 다중비교 무보정. 4개 음성 셀의 최소 p=0.006은 Holm 16개 보정 시 0.1 → 비유의. "no cell significantly positive"는 보정과 무관(모두 ≤0)하지만 음성 주장엔 보정 언급 필요 | "uncorrected; after Holm over 16 cells none survives, we treat the negative cells as descriptive" 한 문장 | 예 |
| 13 | T | Minor | 5.3, eval.py | Wilcoxon: 0 차이 제거 후 `method="approx"`, 연속성 보정 없음, r은 p에서 역산. 동점이 거의 없어 결과엔 영향 없으나 명시 필요. H1b 1분 창 각성: 부트스트랩 CI는 0 제외, Wilcoxon p=0.064 — 두 검정이 엇갈림 | 5.3에 "zero differences dropped, normal approximation" 추가; H1b 문장에 p 병기("CI excludes zero, Wilcoxon p = 0.06") | 예 |
| 14 | T | Minor | 5.2, 5.3 | 사용자별 AUROC가 평가 응답 10~40건(양성 4건이면 SE≈0.17). 개별 값은 거의 무정보, 65명 평균 SE≈0.02. 기준 20건(벤치마크)과 다름. `frac_users_gt_base`(학생이 base를 이긴 사용자 비율 20~42 %)가 더 강건한 보조 지표 | 5.3에 SE 언급, 민감도: min 20건으로 재집계(summarize의 MIN_EVAL=20, 수 초) 수치 한 줄, Table 2에 "% users > base" 열 추가 | 예(열 추가) / 민감도 아니오 |
| 15 | T | Minor | 6.3, 7장 | 가드 시뮬레이션 가정: 두 모델 오류 독립(실제는 같은 입력·씨앗 공유 → 양의 상관 → 쌍대 분산 감소 → 오복귀도 검정력도 변함, 7장은 "more powerful"만 말함), 정답률 정상성, 응답률 100 %(70 %면 42→29 프로브), 매 프로브 반복 검정. 또 베르누이 시뮬은 **학생 활성 상태로 시작**, 루프 시뮬·단말(prefs 기본 false)은 **비활성 시작** — 6.3에 명시 없음 | 6.3에 시작 상태와 가정 4개를 한 문장으로; 7장 "would make all guards more powerful and reduce false reverts" | 예 |
| 16 | T | Minor | 6.3 | "no guard at three probes per day avoids this trade-off" — 4개 규칙만 비교. 일반화 주장 대신 "none of the four" | 문장 수정 | 예 |
| 17 | M | Minor | 5.2 | "first 60 % … learning phase; last 40 % … evaluation" — 학습은 평가 구간에도 계속(prequential). 기간이 1.44일인 사용자는 평가 구간이 14시간 | "prequential: training continues through the evaluation window" + 기간 분포 | 예 |
| 18 | M | Minor | Abstract, 6.5 | 손목-폰 주의가 5.1·7장엔 있으나 Abstract("Smartphone movement")와 6.5(재식별은 손목 특징 결과)에는 없음 | Abstract 한 구("replayed on wrist accelerometry from K-EmoPhone"), 6.5 첫 문장에 "wrist-derived" | 예 |
| 19 | M | Minor | Abstract, 4.2 | 교사 규칙이 검증 0건(n=0)인데 Abstract는 교사를 작동하는 구성요소로 서술. 저자 로그의 θ_v=0.0004(70백분위 smile이 거의 0)는 화면 사용 중 미소 신호가 사실상 없었음을 뜻함 | Abstract에 "whose validity we could not yet test" 추가; 4.2에 k일(3/5/7) 보정 기간과 θ 값 예시 | 예 |
| 20 | M | Minor | 6.2 | H2의 '희소·정확' 비교군으로 esm_ft(같은 과적합 학습식)를 쓰면 "두 과적합 학습식 비교"가 된다. 정규화된 esm_sk(0.582)와 비교하면 학생 열세가 더 큼(−0.064) | 6.2에 "against the regularised ESM logistic the gap widens to −0.06" 한 문장 | 예 |
| 21 | S | Minor | 4.6 표 | 누락: face_landmarker.task 3.7 MB, 카메라 2 fps(본문에만), compileSdk 35·AGP 8.9.1·Java 17·Gradle 8.13, 권한 목록(CAMERA, FOREGROUND_SERVICE, SYSTEM_ALERT_WINDOW, PACKAGE_USAGE_STATS, RECEIVE_BOOT_COMPLETED), 버퍼 2,000표본 ≈ 33시간, 가중치 텍스트 체크포인트 경로, 교사 파라미터 파일, 팔 A↔B 15분 간격 | REPO_MAP §8에서 옮겨 행 4개 추가 | 예 |
| 22 | S | Minor | 4.3 | "numpy re-implementation reproduces the LiteRT probabilities to within 1e-4" — test_loop_sim은 probe_head.txt(TF 기준 확률)와 비교; 단말 LiteRT와는 그 기준을 통해 간접(6e-8) 일치 | "matches the TensorFlow reference (which the device matches to 6e-8) to within 1e-4" | 예 |
| 23 | S | Minor | 6.6 | 카메라 배터리 미측정은 솔직히 적혀 있으나 Threats에는 없음. S12는 "측정했으나 차이 없음"인데 원고 문장도 그렇게 돼 있어 OK. 화면 켜진 창 1,058 mAh/h(S12)는 카메라 포함 상한으로 쓸 수 있음 | Threats에 "camera cost unmeasured" 추가; 6.6에 "screen-on windows including the camera drew 1,058 mAh/h vs 225 mAh/h screen-off, an upper bound not attributable to the camera alone" | 예 |
| 24 | S | Minor | 8장 | 단말 events.csv는 포그라운드 앱 패키지와 브라우저 페이지 제목(PACKAGE_USAGE_STATS)을 기록한다. 8장 "only 52 blendshape coefficients … all data stay on the device"는 이 데이터 부류를 말하지 않음. 현장 연구 DMP·동의서에 민감한 항목 | 8장에 기록 데이터 부류 목록(IMU, blendshape 52, 화면·충전 상태, 앱 패키지·창 제목, 응답) 명시; 창 제목 기록은 현장 연구에서 끄거나 해시 | 예(문장) / 앱 변경 아니오 |
| 25 | T | Minor | Table 1, 6.1 | "Binarising at the user median changes within-user AUROC by less than 0.01": 각성 −0.009 [−0.017, −0.002]로 유의. 사실이지만 "significant but < 0.01" | 문장 수정 | 예 |
| 26 | T | Minor | 그림 3(timecourse) | 1일째 값(0.66)은 평가 가능 사용자가 적어 불안정; 일별 사용자 수 미표시 | 일별 n 주석 또는 2일째부터 표시 | 예(make_figures) |
| 27 | S | Minor | 5.1, 5.2 | 응답·기간 통계와 "max |diff| = 0"의 출처 스크립트가 본문에 없음 | `build_minutes.py` 로그 파일명 또는 s14 노트 인용 | 예 |
| 28 | M | Minor | 7장 (iii) | "data volume larger than one week" 조건은 미검증. 시간 경과(2→7일 0.52→0.56 회복)만으로 외삽 불가 | "untested here; the recovery slope in Fig. 3 is the only hint" | 예 |
| 29 | M | Minor | 3장, 5.1 | 각성 응답 0(16 %)·정서가 0(22 %)을 음성으로 두는 >0 이진화의 영향은 user-median 민감도로만 다룸 | 0 응답 비율 명시(critique M4) | 예 |
| 30 | T | Minor | 5.3 | 부트스트랩 1,000회·시드 0 고정: CI 끝값의 몬테카를로 오차 ±0.005. 괜찮지만 명시 | "1,000 resamples, seed 0" | 예 |

---

## 2. 그림 점검

| 그림 | 가독성 | 본문 캡션 일치 | 문제 |
|---|---|---|---|
| Fig 1 fig_window_ablation | 선 2개 읽기 쉬움 | 본문에 캡션 없음("Figure 1" 언급만) | y축 라벨 상단 잘림("mean over users" 끝). 본문은 CI로 논증하는데 그림엔 CI 없음 → s14 CI 오차막대 추가 권고. x축 로그 눈금 OK |
| Fig 2 fig_density_noise_map | 셀 숫자·색 읽기 쉬움 | 캡션 없음 | **별표가 하나도 없음**(≥2 seeds 기준) ↔ 본문 "four cells significantly negative". 컬러바 라벨 2줄이 길어 PDF 2단에서 잘릴 수 있음. 색 범위 ±0.08 OK |
| Fig 3 fig_conditions | 막대 읽기 쉬움 | 캡션 없음 | **x축 supxlabel이 눈금 숫자와 겹침**(0.45~0.70 위에 글자). 범례 "oracle student"가 Global base 막대 위에 겹침. 결정적 조건(ESM·Platt)은 오차막대 없음(정상이나 설명 필요) |
| Fig 4 fig_timecourse | 선 6개 구분 가능 | 캡션 없음 | **범례가 각성 패널의 학생·ESM 선(2~4일)과 겹침**. 정서가 패널 1일째 학생·앵커 선이 0.70 위로 잘림. supxlabel이 x 눈금과 겹침. 일별 사용자 수 없음 |
| Fig 5 fig_guard | 좋음 | 캡션 없음(본문 Table 3이 대신) | 범례 하단 배치 OK. 14일 창 표시 없음(선택). x축 라벨 "student − base accuracy (Δ)" 명확 |
| Fig 6 fig_selection_bias | 점 겹침 | **본문과 모순**(지적 1): 그림은 consecutive 정의(0.25에서 n=1, q75=0.06), 본문은 since_last_ask(322건, 0.174) | supxlabel이 x 눈금("0.15 (0.15)")과 겹침. 정서가 패널 범례가 데이터와 겹침. n/users 주석이 y=0.50 근처 데이터와 겹침. 재생성 필수 |

공통: main.md에 Figure 1~6의 캡션 문장이 하나도 없다(HTML 주석으로 파일명만). IEEE Access 템플릿은 캡션 필수 → 각 그림에 1~2문장 캡션 추가. 모든 그림의 `fig.supxlabel`이 `bbox_inches="tight"`에서 눈금과 겹치므로 `fig.subplots_adjust(bottom=…)` 또는 `ax.set_xlabel`로 교체.

---

## 3. 즉시 고칠 것 10개 (우선순위순)

1. **6.4 출처 불일치 해소**: `python experiments/loop_sim/rq4_selection.py`(기본 since_last_ask)로 CSV·로그·그림 6 재생성, consecutive 결과는 별도 파일로. 본문 수치는 그대로 유효(rq4_run.log와 일치 확인).
2. **범위 한정 문장**: Abstract·C2·7·9장의 "no on-device update, including an oracle teacher" → "none of the five update rules we tested, even with noise-free copies of the self-report labels". 오라클 → "noise-free label-copy teacher".
3. **bias-only 결과 반영**: Table 2에 student_bias 행(0.603/0.588, pooled 0.714/0.760, Δ −0.037 [−0.059, −0.015] / −0.041 [−0.070, −0.013]) 추가, 5.2 "only learner change" 삭제, 7장 (ii) 권고를 결과에 맞게 수정.
4. **H2 판정 어휘**: "rejected" → "not supported"; 강한 결론은 "student < population model in every arousal cell (upper CI ≤ −0.016)". 그림 2 유의 기준을 본문과 통일.
5. **단말 학습 실가동 0회 명시**(C1·6.6·7장): train 이벤트 전부 samples=0.
6. **검정력 문장**: 8장에 보정/무보정 n 병기(18~24 vs 26~50 at δ=0.10; δ=0.05는 40~70 vs 100~200)와 A10 가정.
7. **Table 2 캡션·pooled 열** 정합(3-seed 평균값으로 교체: 0.647/0.703, 0.662/0.715, 0.719/0.765) + 오라클 Δ 채움 + base 0.638 vs 0.623 설명 + "% users > base" 열.
8. **IPW 한 문장**(6.4) 또는 2.4의 약속 삭제; related_work_gaps.md 2·3·6·7·8항 갱신.
9. **시뮬레이터 학습 호출 규칙**(5.2) 명시: 새 표본 없어도 매 정시 100스텝, 복제 라벨 유효 n≈49 — 7장 과적합 설명에 반영.
10. **그림 캡션 6개 추가 + 겹침 수정**(supxlabel, 범례 위치, Fig 1 CI, Fig 4 일별 n), 6.6 "few seconds per hour"를 폰 환산(약 1.5~3분)으로, Abstract "linear and non-linear" → "at most 7 %", 6.3 "same to two digits" → "within 0.02".

(코드 공개 링크(8번 지적)는 즉시 수정 항목은 아니지만 투고 전 필수.)

---

## 4. 심사자별 판정

**방법론 심사자 — Major Revision.** 시뮬레이터의 한계(라벨 복사 교사)는 원고가 스스로 정확히 적었고, pooled/within-user 분리와 사전등록은 모범적이다. 그러나 결론 문장들이 검증 범위(학습식 5개, 1주, 복제 라벨, 매 정시 반복 학습)를 넘어 "어떤 갱신도 못 한다"로 일반화되어 있고, 이미 돌린 bias-only 결과가 7장의 권고와 어긋나는데도 빠져 있으며, 2.4·gaps 문서의 IPW·밀도 환산 약속이 이행되지 않았다. 범위 한정과 누락 결과 반영은 하루 안에 가능하므로 Reject보다는 Major가 맞다.

**시스템 심사자 — Major Revision.** 시스템 서술(닫힌 식 기울기, LiteRT 제약, 접촉 게이트, 두 팔, 가드 상수, 라이브러리 버전, APK·모델 크기, 단말 비용)은 REPO_MAP·소스와 전부 일치하고 솔직하다. 그러나 (1) 단말 학습이 실제 교사 라벨로 한 번도 돌지 않았다는 사실이 C1의 "trained hourly on the device"에 가려져 있고, (2) 저장소가 비공개라 C5의 재현성 주장을 심사자가 확인할 수 없으며, (3) 모델 확장 비용을 PC 수치로 폰에 외삽했다. 카메라 전력 미측정과 배포 연구 부재는 적절히 고백되어 있다. 공개 저장소 링크와 실가동 사실 명시가 있으면 Minor로 내려간다.

**통계 심사자 — Major Revision.** CI는 참가자 부트스트랩으로 올바르게 쌍대 계산되었고 Table 1·3의 모든 수치가 원본과 맞는다. 다만 6.4의 인용 파일이 본문과 다른 정의의 결과를 담고 있어 수치 감사 자체가 한 절에서 실패하고, H2 "기각"은 CI가 0을 포함하는 비유의 결과를 기각으로 읽은 것이며, 그림 2와 본문의 유의 기준이 다르고, 검정력 20명은 가장 낙관적인 보정 가정 아래의 값이다. 32셀 다중비교, seed 0 CI, 10건 사용자별 AUROC의 잡음, 가드 시뮬레이션의 독립·시작 상태 가정은 문장으로 명시하면 되는 수준이다. 1·4·6·7·11번을 고치면 통계적으로는 Minor 수준이다.
