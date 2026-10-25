# 기기 QA 체크리스트 (수동 E2E, 설계 리뷰 T8)

대상: 갤럭시 노트9, `adb -s 28115dccf9217ece`. 각 항목은 한 번 수행하고 날짜·결과를 적는다.

## 1. 질문 알림 → 격자 → 기록
1. `am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd life_start`
2. events.csv에 `ask_sched` 3건(arm=B, future=0/1)과 dumpsys alarm의 RTC_WAKEUP(오늘 남은 시각 + 다음 날 00:00)을 확인
3. 예약 시각에 "지금 어떠세요?" 알림(id 3)이 뜨면 탭 → 격자 → 색을 누르고 저장
4. events.csv 마지막 줄: `affect … src=ask_B`, `pa/pv` 포함, 알림 id 3 사라짐
5. 급변 팔: 30분 이상 지난 뒤 각성 추정이 0.25 이상 바뀌면 알림 → `src=ask_A`
- 결과: 2026-10-24 ask_sched 3건·알람 등록 확인. 실제 B 발화(22:15)는 대기.

## 2. 서비스 꺼진 상태의 입력 보존
1. `--es cmd life_stop` → `--es cmd grid` → 색 탭 → 저장
2. files/life/pending_events.csv에 1행
3. `--es cmd life_start` → events.csv에 그 행이 붙고 `pending_merged`, pending 파일 삭제
- 결과: 2026-10-24 18:17 통과.

## 3. 모델 파일 교체·폴백
1. `adb push results/models/student_arousal_k7.txt /sdcard/Android/data/kr.ac.seoil.motionaffect/files/models/daily_arousal.txt`(트리 형식이 아니므로 손상 취급) → 서비스 재시작 → events.csv `model_load … source=assets;error=…`, 서비스 살아 있음
2. 올바른 트리 파일을 push → `source=files`
- 결과: 미수행.

## 4. affect.csv v2
1. 시작 1분 뒤 첫 행: 64열, v=2, screen_on·tilt_deg·held, face_frames(화면 켜짐이면 >0)
2. 5분 뒤부터 p_arousal·p_valence 채워짐
- 결과: 2026-10-24 18:15 64열 확인(tilt 1.5°, held 0, face_frames 115).

## 5. 동의·토글·삭제 (T12 후)
- 미구현.

## 6. 배치 실험 모드 (T15 후)
- 미구현.

## 7. 회수 → 분석
1. `adb pull files/life data/raw/life/<날짜>/`
2. `python src/s8_teacher.py` → `python src/s8_student.py` → results/s8_student.csv
3. 학생 가중치 `results/models/student_*_k*.txt` → `adb push … files/models/`
- 결과: 2026-10-24 파이프라인 실행(데이터 1일, 'n 부족').
