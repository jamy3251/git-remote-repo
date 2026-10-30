# STATE (단일 진실)

- 시작: 2026-10-30 17:00
- 종료 예정: 2026-11-01 17:00 (48h)
- 마지막 갱신: 2026-10-30 17:25
- 현재 Phase: 2 (루프 시뮬레이터), 상한 12h → 2026-10-31 05:30. Phase 0은 17:25 완료(소요 25분)

## Phase 순서와 상태
| 순서 | Phase | 등급 | 상한 | 상태 |
|---|---|---|---|---|
| 1 | 0 자원 점검·재현 | 필수 | 4h | 완료 17:25 |
| 2 | 2 루프 시뮬레이터 | 필수 | 12h | 진행 중(격자 실행 중) |
| 3 | 1 벤치마크 | 필수 | 8h | 대기 |
| 4 | 5 프라이버시 | 권장 | 3h | 대기 |
| 5 | 3 교사 타당성 | 권장/선택 | 3h | 대기 |
| 6 | 4 시스템 비용 | 선택 | 2h | 대기 |
| 7 | 6 필드 스터디 설계 | 권장 | 2h | 대기 |
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
- Phase 2(부분): experiments/common/eval.py, experiments/loop_sim/build_minutes.py(→ data/processed/loop_minutes.parquet·loop_summaries.parquet, offset-1 요약 = 기본 모델 입력과 완전 일치), experiments/loop_sim/sim.py(단말 학습식 일치 테스트 tests/test_loop_sim.py 통과), experiments/guard_sim/guard_sim.py(→ results/guard_sim/guard_sim.csv 완료)

## 다음 할 일 한 줄
Phase 2: 격자(results/loop_sim/run_grid.log) 완료 확인 → RQ4 선택 편향 스크립트 → 대표 그림(figures/fig_density_noise_map.pdf·가드 그림) → docs/LOOP_SIM_README.md
