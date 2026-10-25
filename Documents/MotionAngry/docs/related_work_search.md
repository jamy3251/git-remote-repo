# 관련연구 검색 결과 (2026-10-06, 검색식 ②해상도·①핵심·⑤교란)

## 결론
- **움직임→정서에서 샘플링 주파수/해상도를 직접 비교한 연구는 찾지 못함.** 해상도 비교는 낙상 감지(가속도), 스트레스용 피부전도(GSR) 쪽에만 있음 → 우리 차별점 유지.
- **단, WESAD 교란 문제는 이미 지적됨(아래 #1).** 우리 S1b의 '전체 데이터 0.90'은 그대로 쓰면 안 되고, '강도 통제 후 잔여 정보'만 주장해야 함. 그 잔여 정보도 '자세(서기/앉기) 차이'일 수 있다는 반론에 답해야 함.

## 반드시 인용 (우리 주장과 직접 겹침)

| # | 논문 | 핵심 | 우리와 관계 |
|---|---|---|---|
| 1 | "When Wellness Stress Detection Enters Healthcare Workflows: An Iso-Heart-Rate, Cross-Corpus Evaluation of Wrist Wearables", *Healthcare* 14(15):2434, 2026. doi:10.3390/healthcare14152434 【저자명 확인】 | WESAD에서 평균 절대 저크 하나로 스트레스 AUROC 0.828, "활동이 기여하는 것은 대부분 스트레스 생리가 아니라 프로토콜 정체성". 고움직임 창에선 0.53으로 붕괴. 활동 특징을 넣으면 코퍼스 간 전이 악화. 샘플링 비교 없음 | **우리 교란 분석을 지지하면서 동시에 위협.** 우리 coarse 0.80 ≈ 이들 저크 0.83. 차이점: 우리는 '저움직임 창 + 강도 단일 AUC≈0.5' 조건에서 원시 특징 잔여 정보(0.83/0.75)를 보임 — 이들이 안 한 분석 |
| 2 | Woll et al., "Predicting Momentary Mood in Daily Life from Accelerometer Data: Evaluating Single vs. Multiple Sensor Locations Using Machine Learning", *Sensors*, 2026 | 259명 일상, 원시 가속도 64Hz(엉덩이·허벅지·가슴·손목), EMA 각성·정서가·평온, XGBoost, 참가자 단위 5-fold. 엉덩이 R² 0.38, **손목이 가장 약함**, 다중 부착 이득 없음. 샘플링 비교 없음 | 일상 환경에서 원시 가속도→기분이 가능하다는 가장 가까운 근거. 우리 StudentLife 결과(활동 범주=우연)와 대비 |
| 3 | Wampfler et al., CHI 2022 | 타이핑 중 관성 신호만으로 AUC 최대 0.83 (82명, 10주) | 이미 인용 |
| 4 | Oliver & Dakshit, "Cross-Modality Investigation on WESAD Stress Classification", arXiv:2502.18733, 2025 | ACC는 모션 아티팩트·낮은 생리 특이성으로 교차 모달 일반화 약함 (무작위 85:15 분할 — LOSO 아님) | 보조 인용 정도 |

## 참고 (해상도 비교가 다른 분야엔 있음 — 방법론 인용용)
- Sensors 26(1):162, 2026, "The Impact of the Accelerometer Sampling Rate on the Performance of ML and DL Models in Wearable Fall-Detection Systems" — 낙상, 20Hz 근처 최적
- arXiv:2607.08007, "Unit-Independent Low-Rate Wrist GSR Processing for Stress Detection" — GSR 25Hz ≈ 100Hz
- medRxiv 2020.10.22.20217927, "Impact of Reduced Sampling Rate on Accelerometer-based Physical Activity Monitoring" — 활동 분류
- Kołakowska et al., "A Review of Emotion Recognition Methods Based on Data Acquired via Smartphone Sensors", *Sensors* 20(21):6367, 2020 — 관련연구 압축용 리뷰

## 논문 반영 사항
1. 2.2에 #1·#2 추가, "해상도 직접 비교는 없다"를 차별점으로 명시
2. 3.3.3에 #1과의 관계: 같은 교란을 확인했고, 저움직임 창 분석으로 한 단계 더 나아감
3. 한계: 잔여 정보가 자세 차이일 가능성 — #1의 '프로토콜 정체성' 반론에 해당. K-EmoPhone(일상)으로 확인 필요성 강화
