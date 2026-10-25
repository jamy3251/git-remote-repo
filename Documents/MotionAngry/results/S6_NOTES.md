# S6: 일상 데이터 파라미터 탐색 → 단말 탑재 모델 (2026-10-21)

코드: src/s6_params.py(결과 s6_univariate.csv, s6_selection*.csv, s6_baseline.csv, s6_model_size.csv, s6_log.txt),
src/s6_build_2hz.py(단말과 같은 4개 평균 2Hz 특징 → data/processed/kemophone_2hz_block.parquet), s6_block2hz.csv, s6_univariate_block.csv, s6_bootstrap.csv,
src/export_daily.py(→ assets daily_arousal.txt·daily_valence.txt 각 7.5KB, selftest_daily.txt 3건), 앱 DailyEngine.java·LifeLogService(1분마다 추정·알림 표시·life/affect.csv).

## A. 단변량 (4개 평균 2Hz, 3,771건·77명)
- 각성: 저크·움직임 세기 계열이 상위. b2_med_jerk_mean 전체 AUROC 0.626, 사람 안 상관 ρ=0.24, 72명 중 87.5%가 같은 방향(움직임 변화가 클수록 각성↑). sec_std_mean 0.626/0.24/86%.
- 정서가: 같은 계열 0.59, ρ≈0.15, 74~78% 같은 방향. 스트레스: 0.555 이하, 방향 일치 61~69%.
## B. 중첩 전진 선택(바깥 5겹·안쪽 3겹, decimate 특징): 각성 k=1 0.608 → k=5 0.616, 전체 40개 0.632. 1~2개로 대부분 확보.
## C. 개인 기준선 보정(과거 응답만으로 표준화): 각성 0.632 → 0.609(z만), 0.627(raw+z) — 효과 없음.
## D. 모델 크기(각성): 50트리×잎3 0.635(8KB 추정) ≥ 200×15 0.613(186KB). 10×3도 0.621.
## 단말용(4개 평균 2Hz, 50트리×잎3): 각성 0.623, 정서가 0.587, 스트레스 0.544. 파라미터 1개(med_jerk_p10) 각성 0.613.
## 부트스트랩(참가자 1,000회, 같은 50×3 설정): 각성 전체−OS +0.076[0.050,0.103], 1개−OS +0.066[0.039,0.093], 전체−1개 +0.010[0.001,0.021]; 정서가 전체−OS +0.055[0.029,0.082].
## 남은 일: 폰 연결 후 selftest(일상 모델 일치·분 단계/추정 단계 시간), life/affect.csv 실제 동작 확인.
## 주의: 모델은 손목 가속도로 학습 → 폰 단독 사용 시 정확도 미검증(한계로 명시).

## 2026-10-23 단말 selftest (노트9)
- 버그 수정: selftest_daily.txt의 결측 행 'nan'을 Java가 못 읽음(MainActivity.selftestDaily) → "nan"을 NaN으로 처리, APK 재빌드·설치.
- 일상 모델: 3건, 특징 최대 상대오차 6.6e-15, 확률 오차 5.6e-17 → Python과 일치.
- 시간(중앙값/p95): 분 단계 222/412 us, 추정 단계(30분 요약+두 모델) 257/460 us, 모델 로드 4.3 ms.
- 같은 실행의 기존 4개 주파수 검사도 오차 일치. 단 이번 실행 시간은 느림(32Hz 특징 중앙값 13 ms; 10-13엔 3.8 ms) — 폰 상태(저클럭 등) 영향, 표엔 반복 측정 후 쓸 것.

## S7 시간순 누적 학습 (2026-10-23, src/s7_cumulative.py → results/s7_cumulative.csv, s7_log.txt)
출하 모델(LOSO 50×3) vs 자기 처음 k개 응답 로지스틱(own) vs 둘 평균(blend), k번째 이후 응답에서 평가.
- own 단독은 k=30까지도 출하 모델보다 못함(각성 0.61 vs 0.64).
- blend: 각성은 출하와 같음(k=20 0.637 vs 0.628, 사용자별 평균은 오히려 낮음). 정서가는 전체 AUROC 0.59→0.63(k=30)으로 오르지만 사용자별 평균 AUROC는 내려감(0.61→0.59).
- 해석: 개인 모델이 하는 일은 사용자 간 수준 차이 보정(전체 AUROC↑)이지 사용자 안 판별 개선이 아님. S6-C(개인 기준선 보정 효과 없음)와 일치. '데이터가 쌓이면 저절로 좋아진다'는 주장은 이 설정에선 성립 안 함 → 개인화는 라벨 종류(표정·좋아/별로)나 특징을 바꿔야 함.

## 2026-10-23 앱: 감정 격자 + 질문 알림 (APK 재빌드·설치, 일상 기록 재시작됨)
- AffectGridActivity: 연속 색 격자(가로 정서가, 세로 각성) 1탭 → v,a,세기(i), 가장 가까운 감정 이름 자동(8개, 칩으로 변경), 서비스 추정이 있으면 맞아요/아니에요/모르겠음.
- LifeLogService: ACTION_AFFECT → events.csv type=affect value="v=..;a=..;i=..;e=..;j=..;pa=..;pv=..;src=notification|overlay|ask|main". 각성 추정이 지난 질문보다 0.25 이상 움직이고 30분 지나면 '지금 어떠세요?' 알림(id 3, type=ask 기록). 알림·오버레이에 '감정' 버튼.
- 진입 테스트: am start MainActivity --es cmd grid. 검증: 격자→저장→events.csv 기록 확인됨(22:02). 맞아요 버튼은 adb 탭 충돌로 미확인 → 사용자 1회 확인 필요.
- 분석 때: v,a를 K-EmoPhone 축으로 보고 affect.csv(pa,pv)와 시각 결합 → 단말 추정 vs 본인 격자 AUROC, j(맞아요/아니에요) 비율.
