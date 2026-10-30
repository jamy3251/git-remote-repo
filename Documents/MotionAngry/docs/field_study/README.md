# 현장 연구 설계 패키지 (docs/field_study/)

작성 2026-10-30. 저자 1인 N-of-1과 시뮬레이션(`docs/PREREG.md`)을 넘어, 다른 사람의 폰에서 온디바이스 교사-학생 루프를 4주 동안 검증하기 위한 문서 묶음. IRB 제출·참가자 모집·기기 준비의 출발점이며, 코드와 다른 문서는 바꾸지 않았다.

## 파일

| 파일 | 내용 | 상태 |
|---|---|---|
| `PROTOCOL.md` | 목적, 현장 가설(H-F1~H-F3, PREREG RQ2·RQ3·RQ5 대응), 4주 설계(기준선 1주 + 학생 활성 3주, ABAB 대안), 선정·제외 기준, 절차, 측정 변수, 중단 기준, 일정, 역할 | 초안 v0.1 |
| `CONSENT_FORM.md` | 연구 참여 설명서 + 동의서(필수 4항·선택 3항, 서명란). 사진·영상 미저장과 단말 내 보관을 명시 | 초안 v0.1, IRB 양식으로 옮겨야 함 |
| `DATA_MANAGEMENT_PLAN.md` | 수집 파일·크기, 참가자 코드 `F01…`, USB 직접 복사 + 체크섬, 암호화 보관·3년 보존·파기, 접근 권한, 공개 범위(재식별 7.0% 근거) | 초안 v0.1 |
| `APP_READINESS_CHECKLIST.md` | `docs/qa_checklist.md`에 없는 현장 전용 항목: Android 11~15 호환, 동의 화면·코드 입력(T12), 기준선 모드, 권한·배터리 안내, 용량 추정, 회수 절차, 장애 대응, 빌드 서명 | 대부분 미완 |
| `PREREGISTRATION_FIELD.md` | OSF 양식: 가설, 설계, 표본 크기, 변수, 분석 계획(쌍대 Wilcoxon + 참가자 부트스트랩, 가드 로그, 교사 일치율), 제외 규칙, 이탈 기록표 | 등록 전 |
| `analysis_skeleton.py` | 분석 함수 서명·docstring만(TODO). `experiments/common/eval.py`의 `user_auc`·`boot_ci_users`·`wilcoxon_paired`를 import | 뼈대 |

## 사람이 해야 할 일 (순서대로)

### A. 결정 (문서의 `[PENDING]`을 지우는 일)
1. **표본 크기**: PREREG RQ2 시뮬레이터 결과로 검정력 분석 → `PROTOCOL.md` 4절, `PREREGISTRATION_FIELD.md` 4절.
2. **IRB 경로**: 서일대학교에 기관 IRB가 있는지, 없으면 위탁 IRB(공용 IRB 등) 사용 여부와 학부생이 연구책임자가 될 수 있는지(아니면 지도교수 명의) 확인 → `PROTOCOL.md` 9절.
3. **보상 금액**, **연락처**, **IRB 연락처** → `CONSENT_FORM.md`.
4. 기준선 1주 채점을 DriftGuard 14일 창에 넣을지, `teacher_params.txt`를 전 참가자 공통으로 고정할지(기본값: 공통 고정) → `PREREGISTRATION_FIELD.md` 9절.
5. 파일럿(저자) 로그로 팔 A 하루 발화 수를 집계해 하루 질문 상한이 6회를 넘는지 확인 → `PROTOCOL.md` 3.3.

### B. IRB 제출
- 제출 서류: 연구계획서(`PROTOCOL.md` 기반), 설명서·동의서(`CONSENT_FORM.md`), 개인정보 처리 계획(`DATA_MANAGEMENT_PLAN.md`), 모집 공고문(미작성), 앱 동의 화면 캡처(T12 구현 후), APK SHA-256과 권한 목록(INTERNET 없음 증빙).
- 승인 전에는 저자 외 누구에게도 앱을 설치하지 않는다(설계 문서의 "친구 3~5명 APK"도 승인 이후로).

### C. 앱 준비 (`APP_READINESS_CHECKLIST.md`)
- 코드 작업: T12(동의 화면·참가자 코드·토글 해시·삭제 버튼·서비스 게이트), 기준선 모드 플래그와 D7 자동 해제, Android 12+/13+ 권한(정확한 알람·알림), `foregroundServiceType`, 크래시 파일, 고정 keystore.
- 시험: Android 10·12·14 각 1대 24시간 무인 기록 → 체크리스트 9절 표 채우기.
- 노트북에 adb·회수 스크립트 준비, 참가자 1명분 모의 회수(체크섬 비교까지).

### D. 모집·설치·운영
- 모집 공고(학과 게시·SNS), 사전 문의 응대, 선정 기준 확인(Android 버전·저장공간·단독 사용).
- 설치 방문(20분/인): 동의 서명 → 설치 → 권한·배터리 설정 → `events.csv` 확인(체크리스트 4절).
- 운영: 3일째·주 1회 확인 메시지, 장애 대응표(체크리스트 7절), 중단 기준(`PROTOCOL.md` 7절) 판단.
- 종료 방문(20분/인): 설문 → USB 회수·체크섬 → 삭제 입회 → 보상.

### E. 분석·보고
- `PREREGISTRATION_FIELD.md`를 첫 설치 전에 OSF(또는 저장소 커밋 해시)로 고정.
- 회수 후 `analysis_skeleton.py`의 TODO를 채우고 `results/field_*.csv` 생성, 이탈이 있으면 사전등록 8절에 기록.
- IRB 종료 보고, 원고 반영(`paper/`), `docs/evolve_loop.md` 장부 갱신.

## 이 패키지가 전제한 것 (틀리면 문서를 고쳐야 함)

- 참가자는 **자기 Android 폰**을 쓴다(연구용 기기 대여가 아님). 그래서 Android 11~15 호환 항목이 생겼다.
- 1차 비교는 같은 분 행의 `p_arousal`(출하) vs `p_student_a`(학생)의 사후 쌍대 비교라, 참가자가 어느 모델을 봤는지는 1차 결과에 영향이 없고 `j` 일치율·팔 A 발화에만 영향이 있다.
- 교사 임계값은 전 참가자 공통(저자 파일럿 값)으로 고정한다.
- 자료는 USB 유선으로만 전달하고, 보존은 연구 종료 후 3년이다.
- 재식별 수치 7.0%는 K-EmoPhone 77명 손목 특징 기준(`results/S14_NOTES.md`)이며, 현장 폰 특징에서는 다시 재야 한다.
