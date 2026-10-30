# STATE (단일 진실)

- 시작: 2026-10-30 17:00
- 종료 예정: 2026-11-01 17:00 (48h)
- 마지막 갱신: 2026-10-30 19:25
- 현재 Phase: 2 (루프 시뮬레이터), 상한 12h → 2026-10-31 05:30. Phase 0은 17:25 완료(소요 25분)

## Phase 순서와 상태
| 순서 | Phase | 등급 | 상한 | 상태 |
|---|---|---|---|---|
| 1 | 0 자원 점검·재현 | 필수 | 4h | 완료 17:25 |
| 2 | 2 루프 시뮬레이터 | 필수 | 12h | 진행 중(격자 실행 중) |
| 3 | 1 벤치마크 | 필수 | 8h | 완료 19:20 (results/benchmark/summary.csv, BENCHMARK_NOTES.md; 1.4는 DATASETS.md 절차만) |
| 4 | 5 프라이버시 | 권장 | 3h | 진행 중(reident.py 실행 중; 가중치 유출은 격자 뒤) |
| 5 | 3 교사 타당성 | 권장/선택 | 3h | 3.1 완료(표본 0: 얼굴 검출된 탭 없음, results/teacher/) · 3.2 DATASETS 에이전트 · 3.3 대기 |
| 6 | 4 시스템 비용 | 선택 | 2h | 절차서 docs/DEVICE_BENCH.md 완료, scaling.py 작성(CPU 한가할 때 실행), minute_timing.csv 완료 |
| 7 | 6 필드 스터디 설계 | 권장 | 2h | 문서 7개 완료(docs/field_study/), 검정력 분석 [PENDING: 격자 효과 크기] |
| 8 | 7 논문 초안 | 필수 | 8h | 대기 |
| 9 | 8 자체 심사·보고 | 필수 | 2h | 대기 |

## [선택] 항목 실행/생략 (Phase 0.1 결과)
- 단말 연결: 없음(adb devices 빈 목록) → Phase 4는 스크립트·절차만, PC 스케일링은 수행
- 웹 접근: 가능(doi.org 302) → 참고문헌 DOI 확인·저널 조사 수행
- LaTeX/pandoc: 없음 → paper/sci/main.md 마크다운 초안
- 저자 앱 로그: 있음(data/raw/life/2026-10-25 affect.csv 331행) → Phase 3.1 수행
- 외부 데이터셋: WESAD 로컬 보유(data/raw/WESAD), 나머지는 절차만

## 완료된 산출물
- Phase 0: docs/FEASIBILITY.md, docs/REPO_MAP.md, requirements-research.txt, results/repro/REPRO.md(+로그), docs/MANUSCRIPT_ISSUES.md, paper/kr/manuscript.md, docs/PREREG.md(고정), docs/ASSUMPTIONS.md
- Phase 1: experiments/benchmark/benchmark.py → results/benchmark/{summary.csv, benchmark_log.txt, BENCHMARK_NOTES.md}, figures/fig_window_ablation.pdf; docs/DATASETS.md
- Phase 6: docs/field_study/{PROTOCOL, CONSENT_FORM, DATA_MANAGEMENT_PLAN, APP_READINESS_CHECKLIST, PREREGISTRATION_FIELD}.md, analysis_skeleton.py, README.md
- Phase 7(부분): paper/sci/{main.md 뼈대, related_work.md, references.bib(35건 DOI 확인), related_work_gaps.md}
- Phase 4(부분): docs/DEVICE_BENCH.md, experiments/system/scaling.py(미실행), results/system/minute_timing.csv
- Phase 3.1: experiments/teacher/teacher_validity.py → results/teacher/ (얼굴 검출된 탭 0건)
- Phase 2(부분): experiments/common/eval.py, experiments/loop_sim/build_minutes.py(→ data/processed/loop_minutes.parquet·loop_summaries.parquet, offset-1 요약 = 기본 모델 입력과 완전 일치), experiments/loop_sim/sim.py(단말 학습식 일치 테스트 tests/test_loop_sim.py 통과), experiments/guard_sim/guard_sim.py(→ results/guard_sim/guard_sim.csv 완료)

## 다음 할 일 한 줄
Phase 2: 격자(results/loop_sim/run_grid.log) 완료 확인 → RQ4 선택 편향 스크립트 → 대표 그림(figures/fig_density_noise_map.pdf·가드 그림) → docs/LOOP_SIM_README.md
