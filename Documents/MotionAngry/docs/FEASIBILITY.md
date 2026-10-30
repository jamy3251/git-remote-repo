# FEASIBILITY (Phase 0.1 자원 점검, 2026-10-30 17:10)

| 점검 | 방법 | 결과 | 결정 |
|---|---|---|---|
| K-EmoPhone 원본·전처리 | `ls data/raw/kemophone`(P01~P77.zip), parquet 행 수 | 원본 zip 77개. `data/processed/kemophone_2hz_block.parquet` 3,771행×38열·77명(응답 직전 30분 요약 32특징+메타), `kemophone_esm_features.parquet` 5,582행(s4 전체 ESM), `kemophone_window_sweep.parquet` 3,339행×187열(창 길이 1~60분) | 전 Phase 수행 가능 |
| 저자 앱 로그 | `wc -l data/raw/life/*/affect.csv events.csv` | 2026-10-20: affect 0행·events 337행(초기 테스트), 2026-10-25: affect 331행(분 단위, 표정 집계 포함)·events 773행, face_*.csv 다수 | Phase 3.1 수행(표본 작음을 그대로 보고) |
| 안드로이드 단말 | `adb devices` | 연결 없음 | Phase 4는 절차서·스크립트 + PC 스케일링만 |
| 웹 접근 | `curl https://doi.org/...` | HTTP 302(정상) | 참고문헌 DOI 확인·저널 조사 수행 |
| LaTeX | `which pdflatex xelatex tectonic pandoc` | 모두 없음 | 초안은 `paper/sci/main.md`(pandoc 호환 마크다운). LaTeX 설치 시도는 하지 않음 |
| CPU·메모리 | `nproc`, WMI | 28 논리 코어, 34 GB | 시뮬레이터 격자 전체(p 4×d 2×b 2×seed 3=48 조건) 사용자 병렬로 가능 |
| Python | `python --version`, 패키지 | 3.11.9, lightgbm 4.7.0, scikit-learn 1.8.0, pandas 2.3.3, numpy 2.1.3, scipy 1.15.3 | requirements-research.txt에 고정 |
| 기존 테스트 | `python -m pytest tests`, `gradle testReleaseUnitTest --offline` | pytest 13 통과, JUnit 31 통과(9 클래스; 로그 results/repro/junit_run.log) | 기준선 확보 |
| 외부 데이터셋 | `ls data/raw` | WESAD 원본·창 특징 보유(실험실 프로토콜, 손목·가슴). dataset_rds.zip(PAM?) 보유 | Phase 1.4: WESAD만 즉시 가능, 나머지 절차 문서 |

## [선택] 항목 확정
- Phase 1.4 데이터셋 확장: WESAD(로컬)만 재현 시도, 그 외는 docs/DATASETS.md에 절차.
- Phase 3.2 공개 얼굴 데이터셋: 절차만.
- Phase 4 단말 측정: 절차·스크립트만. PC 스케일링(33→330→3,300 파라미터)은 수행.
- 저널 조사(docs/VENUE.md): 수행(웹 가능).
