# TODOS

## Analysis

### K-EmoPhone 심박·피부전도를 움직임 추정의 생리 기준으로 검증

**What:** K-EmoPhone의 HR.csv·EDA.csv를 30분 응답 창에 맞춰 정렬하고, 움직임 기반 p_arousal과의 스피어만 상관·AUROC(심박 상위 사분위를 양성으로)를 계산한다. 활동 세기(움직임 표준편차)를 통제한 결과를 함께 보고한다.

**Why:** 움직임 추정이 '무엇'을 잡는지(움직임 세기가 생리 각성의 대리인지) 설명하고, 심사의 "그게 각성이냐"라는 질문에 ESM 응답 없이도 답한다. 폰에는 심박이 없으므로 제품 기능이 아니라 분석용 기준이다.

**Context:** docs/evolve_loop.md '다음 반복 후보'에서 나옴. 손목 착용 시간이 약 1/3이라 겹치는 창이 줄고, HR은 활동에도 오르므로 교란 해석이 필요하다. 시작점: src/s6_build_2hz.py의 창 정렬 코드, data/raw/kemophone/P*.zip 안의 HR.csv·EDA.csv. 2026-10-24 eng review D16에서 "지금 만들기"였다가 사용자 정정으로 TODO.

**Effort:** S
**Priority:** P2
**Depends on:** None (데이터 보유)

### 손목 원시 신호로 신원 식별 재검 (간호사 E4·DAPPER)

**What:** src/s11_identity_probe.py를 원시 손목 신호(32Hz 창 특징 + 보행 구간)·날짜 교차 분할·EER 산출로 확장해 간호사 E4(15명)·DAPPER(88명)에서 식별 성능을 잰다.

**Why:** 사용자 아이디어(정서·움직임 패턴을 인증 ID로)의 성립 여부를 데이터로 판정한다. 성립하지 않아도 '비식별성' 주장을 2Hz 요약에서 원시 신호까지 확장할 수 있다.

**Context:** S11(2026-10-24): 2Hz·30분 요약으로는 77명 중 top-1 7%(우연 1.3%), 정서 서명 벡터 top-1 3% → ID 불성립, 프라이버시 논거로 전환. 문헌상 폰 보행 인증은 같은 날 EER 3%, 날짜 교차 11~14%, 모방 공격에 취약. 시작점: results/S11_NOTES.md 판단 2번, s11_identity_probe.py identify()에 날짜 교차 분할 추가. 누출 주의: 검증 표본을 정답 사용자 통계로 정규화하면 안 됨(I21).

**Effort:** M
**Priority:** P3
**Depends on:** 간호사 E4(Zenodo 5514277) 다운로드, DAPPER 신청 승인

### 비트 동조 지수 (beat entrainment index) 를 교사 신호로 추가

**What:** Android `Visualizer`로 재생 중 오디오의 온셋·템포를 단말에서 뽑고, IMU 0~3Hz 성분과의 위상 코히어런스로 '동조 지수'를 계산해 표정과 나란한 두 번째 교사 신호로 쓴다.

**Why:** 라벨 없이 나오는 연속 지표라 라벨 병목(S7)을 우회하고, 음악심리학의 groove/entrainment 문헌이 선행 근거가 된다. 2차 의견(2026-10-24 office-hours)의 가장 독창적인 제안.

**Context:** S5(7시간 로그)에서 좋아한 곡의 0~3Hz 움직임이 별로인 곡보다 컸다(p=0.058, 13:13). 이게 정서가 아니라 '박자에 몸이 잠기는 현상'일 수 있다. 1단계 교사-학생 판정 결과가 "좋아한 곡에서만 0~3Hz 증가"로 나오면 착수. 시작점: docs/designs/motionangry-ondevice-loop.md Approach C, results/S5_NOTES.md. 리스크: RECORD_AUDIO 권한, DRM 앱에서 Visualizer 차단, 폰 내려둔 상태에서 신호 약함. 음악에만 적용(영상·SNS 제외).

**Effort:** L
**Priority:** P3
**Depends on:** 1단계 게이트 결과(동조 현상 여부), Android 10 Visualizer 권한·DRM 확인

## Completed
