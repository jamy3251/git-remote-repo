# Phase 0.3 재현 (2026-10-30 17:03~17:18, 스크립트 전부 재실행; 로그 results/repro/*.log, 순서·시각 timing.txt)

| 지시서 1장의 수치 | 재현 스크립트 | 재현 값 | 판정 |
|---|---|---|---|
| K-EmoPhone 77명, 응답 3,771건, 응답 직전 30분 | kemophone_2hz_block.parquet (s6_build_2hz) | 3,771행·77명 | 일치 |
| 기본 모델 LOSO 각성 0.623, 정서가 0.587 | src/s7_cumulative.py (k=0 base) | 0.623 / 0.587 (사용자별 평균 0.614 / 0.594) | 일치 |
| 활동 범주 모델 각성 0.546 | src/s4_kemophone.py (phone_act) | **OS 활동(phone_act) 각성 0.516(전체) / 0.542(사용자별)**. 0.546은 S4 표의 '손목 움직임 세기 1개'의 **정서가** 값 | **불일치 → 원고 수정 필요(0.516 또는 0.542로)** |
| 창 길이 1분 0.594/0.558, 15~30분 0.62~0.63/0.58~0.59, 60분 저하 | src/s13_window.py | 1분 0.594/0.558(전체; 3,160건 부분집합), 15분 0.625/0.580, 30분 0.621/0.585, 60분 0.614/0.569 | 일치(응답 집합이 3,160건임을 원고에 명시해야 함) |
| 응답 누적 정서가 전체 0.595→0.632, 사용자별 0.611→0.585 | src/s7_cumulative.py | k=10 base 전체 0.595 → k=30 blend 전체 0.632; k=30 base 사용자별 0.611 → blend 0.585 | 일치(비교 대상이 base→blend임을 명시) |
| 저크–각성 양의 관계 사용자 87.5% | 생성 코드 없음(s6_univariate_block.csv) → results/repro/repro_jerk_agree.py로 재계산 | 응답 ≥20인 72명 중 87.5%, 전체 AUROC 0.626, 사람 안 ρ 0.241 | 일치(기준 '응답 ≥20·72명' 명시 필요) |
| 단말 학습 22.7~44.4ms, 로드 2.3~34.8ms, 메모리 0.9~1.3MB, PC와 10⁻⁸ 이내 | 단말 미연결 → 재실행 불가. 원본 로그 data/raw/life/2026-10-25/litert_probe.txt, results/S8_NOTES.md | 로그상 최대 차 6.0×10⁻⁸ (MANUSCRIPT_ISSUES B1) | 재실행 불가·기록 확인. "10⁻⁸ 이내"는 "10⁻⁷ 이내(최대 6.0×10⁻⁸)"로 수정 |
| 비접촉 보류 18.3%, 보류 창 각성 0.595 < 0.623 | src/s9_contact_rules.py | dropped 0.183, contact=0 0.595, all 0.623 | 일치 |
| 비식별성 창 1개 7.0%, 창 10개 18.6% | src/s11_identity_probe.py | top1 0.0696, vote10 0.186 (로지스틱) | 일치 |
| 저자 2일 360분, 얼굴 검출 31분, 70백분위 교사 기준값 | src/s8_teacher.py, src/s8_student.py | affect_rows=360, tuning_minutes=31, θ_v 0.000·θ_a 0.024 (percentile70) | 일치 |
| 기존 테스트 44개 | pytest, gradle testReleaseUnitTest | 13 + 31 전부 통과 (junit_run.log) | 일치 |

재실행으로 results/*.csv 는 바뀌지 않았다(git diff: s8_student.csv만 events 추가로 scheduled 1→4, fired 0→1).
