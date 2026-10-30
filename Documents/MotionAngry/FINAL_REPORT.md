# FINAL REPORT — 48시간 자율 연구 (2026-10-30 17:00 시작, 2026-10-30 22:45 1차 종료; 소요 약 6시간)

지시서: "온디바이스 정서 추정 자기 학습 구조를 SCI급 논문으로". 단일 진실 docs/STATE.md, 시간순 기록 docs/RESEARCH_LOG.md, 사전등록 docs/PREREG.md(고정), 가정 docs/ASSUMPTIONS.md(A1~A10), 백로그 docs/BACKLOG.md. 모든 수치는 저장소 스크립트의 출력 파일에서만 왔다.

## 1. 한 일 (Phase별, 커밋)
| Phase | 산출물 | 커밋 |
|---|---|---|
| 0 자원 점검·재현 | docs/FEASIBILITY.md, REPO_MAP.md, MANUSCRIPT_ISSUES.md(37건), results/repro/REPRO.md, requirements-research.txt, PREREG.md | cb056ab |
| 2 루프 시뮬레이터 | experiments/loop_sim/{build_minutes,sim,rq4_selection}.py, experiments/guard_sim/guard_sim.py, experiments/common/eval.py, results/loop_sim/{summary.csv, LOOP_SIM_NOTES.md}, results/guard_sim/, figures 6개·표 2개, docs/LOOP_SIM_README.md, tests/test_loop_sim.py(단말 학습식 일치) | 8f6fc6b |
| 1 벤치마크 | experiments/benchmark/benchmark.py, results/benchmark/{summary.csv, BENCHMARK_NOTES.md}, docs/DATASETS.md | 748c03a |
| 5 프라이버시 | experiments/privacy/{reident,weight_leak}.py, results/privacy/PRIVACY_NOTES.md | 2d0325a, 8f6fc6b |
| 3 교사 타당성 | experiments/teacher/teacher_validity.py → 표본 0(얼굴 검출된 탭 없음); 3.2는 DATASETS.md 절차; 3.3은 오라클 조건으로 대체(A9) | 748c03a |
| 4 시스템 비용 | docs/DEVICE_BENCH.md(절차), results/system/{scaling_pc.csv, minute_timing.csv} | fb1248a |
| 6 현장 연구 | docs/field_study/ 7개 + experiments/field/power.py → results/field/power.csv | 748c03a, 2d0325a |
| 7 논문 초안 | paper/sci/{main.md(전 절), related_work.md, references.bib(35건 DOI 확인), related_work_gaps.md}, paper/kr/manuscript_revised.md(35건 수정+수정 내역), docs/VENUE.md | fb1248a, ad38b51 |
| 8 자체 심사 | docs/SELF_REVIEW.md(3인 심사, 30건 + 수치 감사 180개) → 즉시 수정 23건 반영 | (이 커밋) |

## 2. 확인된 가설과 기각된 가설 (수치와 근거 경로)
| 가설 | 판정 | 근거 |
|---|---|---|
| H1a 움직임 32특징 > 활동 범주 | **지지(OS 활동 범주 대비)**: 각성 +0.055 [0.027, 0.081], 정서가 +0.056 [0.024, 0.094]. 단 손목 3범주 coarse와는 동등(+0.013 [−0.003, 0.033]) | results/benchmark/summary.csv |
| H1b 15~30분 > 1·60분 | **부분 지지**: 1분(각성 −0.027 [−0.050, −0.005])·5~10분(정서가)은 30분보다 낮음; 15·30·60분은 구분 안 됨(60분 저하 주장 근거 없음) | results/benchmark/summary.csv |
| H2 고밀도 잡음 교사 > 희소 정확 ESM, p* 존재 | **지지 안 됨(32셀 전부)**: 차이 −0.001~−0.064, 양의 유의 셀 0; p* 없음 | results/loop_sim/summary.csv, fig_density_noise_map.pdf |
| (추가) 온디바이스 갱신이 사용자 안 AUROC를 올리는가 | **기각(6개 학습식 전부, 오라클 포함)**: 오라클 학생 0.514/0.567 vs 기본 0.638/0.627; 절편만 갱신도 0.603; 전체 AUROC만 0.62→0.63~0.77 상승(수준 학습) | results/loop_sim/summary.csv |
| RQ3 현행 가드 검정력 <0.5, 오복귀 >0.2 | **반만 맞음**: 검정력 0.76(Δ=−0.10, 14일), 오복귀 0.48(14일)·0.68(28일); 베이즈/CI 가드는 오복귀 0.08~0.11·검정력 0.25~0.30; SPRT 작동 안 함 | results/guard_sim/guard_sim.csv |
| RQ4 A 표본 AUROC가 치우침 | **지지(방향은 정의 의존)**: 단말 규칙 A=8.5%, 극단성 1.36×, 사용자별 평가 가능 4명; 0.15 임계에서 전체 −0.022; IPW로 복구 안 됨 | results/loop_sim/rq4_selection.csv |
| RQ6 가중치 식별률 < 우연 5배 | **기각**: 학생 가중치 33개 top-1 82%(63×), 특징 32개는 7.0%(5.4×, 비선형 공격자도 ≤5.4×, 10명 후보 22%) | results/privacy/{weight_leak,reident}.csv |
| RQ7 비용 스케일링 | 33파라미터 100스텝 0.4~4.3ms(PC), 3,300파라미터·2,000배치 1.47s; 단말은 PC의 60~120배 느림 → 대형 모델은 시간당 1.5~3분 | results/system/scaling_pc.csv |

핵심 메시지(논문 포지셔닝): "1주·49응답 규모에서 온디바이스 자기 학습은 사용자 안 판별을 높이지 못하고 수준만 배운다. 이것은 실패가 아니라 조건이다: 교사가 응답 사이의 정보를 더해야 하고, 학습식이 수준을 천천히 보정해야 하며, 무작위 프로브 가드와 가중치 비공개가 필수다."

## 3. 생략·미완 항목과 이유
- Phase 1.4 외부 데이터셋 재현: 폰 가속도+현장 정서 자기보고 공개셋 없음(docs/DATASETS.md). StudentLife는 활동 추론뿐이라 보류(BACKLOG).
- Phase 3.1 교사 타당성: 저자 로그에 얼굴 검출된 탭 0건 → 결과 없음(그대로 보고). 3.2 공개 얼굴 데이터셋은 접근 요청 필요.
- Phase 3.3 임계 적응: 오라클(p=1)이 상한이고 그조차 기본 모델 아래 → 별도 실행 안 함(A9).
- Phase 4 단말 측정: 단말 미연결. 절차서와 스크립트만. 카메라 전력 【미실시】.
- 단말 학습이 실제 교사 라벨로 돌아간 기록 없음(31분 < 50표본) — 논문에 명시.
- RQ4 IPW는 사용자별 발화율만으로 보정(시각대·움직임 수준 확장은 BACKLOG). 양자화 완화책의 정확도 손실 【미실시】.
- 격자 다중비교 보정·seed 통합 CI·10응답 사용자별 AUROC 잡음은 서술로만 다룸(SELF_REVIEW 통계 심사 지적).
- LaTeX·pandoc 없음 → paper/sci/main.md 마크다운(pandoc 호환).

## 4. 사용자가 해야 할 일
1. **투고 판단**: docs/VENUE.md — 1순위 IEEE Access(SCIE, 쪽수 무제한, Negative Result 유형), 대안 Pervasive and Mobile Computing. TAFFC·IMWUT은 현장 연구 뒤.
2. **저장소 공개(M11)**: 현재 비공개 monorepo. 코드·results/*.csv·응답 ID 목록을 공개 저장소로 분리하고 DOI(Zenodo). 초안 C5가 이것을 전제함.
3. **단말 측정**: docs/DEVICE_BENCH.md 절차대로 교사 포함/제외 배터리, 배치 640·2,000 학습 시간(앱에 batch 인자 추가 필요), 폰 연결 후 10-25 이후 로그 pull.
4. **IRB·현장 연구**: docs/field_study/ (PROTOCOL, CONSENT_FORM, DMP, 체크리스트, 사전등록). 참가자 기본값 20명·4주(δ=0.10 검출; 보정 없이면 50명). 앱 변경 필요 항목: 동의 화면·참가자 코드·기준선 모드(APP_READINESS_CHECKLIST).
5. **데이터셋 등록(선택)**: DAPPER(Synapse), K-EmoCon(Zenodo 요청), Emognition(EULA) — docs/DATASETS.md §3.
6. **HWP 반영**: paper/kr/manuscript_revised.md의 '수정 내역' 35건(활동 범주 0.546→0.547/0.567, 10⁻⁸→6.0×10⁻⁸ 등)을 HWP에 옮기고, HWP에만 있는 "저크 시간변화율" 문구·로마자 혼용 확인.
7. **영문 초안 마무리**: docs/SELF_REVIEW.md의 '즉시 고칠 것' 중 남은 항목(그림 캡션 번호 정리, 다중비교 문장, seed 통합 CI 표) 확인 후 Abstract 최종화. 추천 저널 템플릿(IEEEtran)으로 변환.

## 5. 추천 저널
IEEE Access(1순위; 현 증거 수준·Negative Result 허용·4~6주 판정). 현장 연구(20명·4주) 결과가 나오면 Pervasive and Mobile Computing 또는 IEEE TAFFC로 상향.
