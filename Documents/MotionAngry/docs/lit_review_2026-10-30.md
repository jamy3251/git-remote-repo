# 관련 연구 보강 문헌 조사 (2026-10-30)

목적: 관련 연구 절을 SCI급 심사에 견디는 수준으로 보강하기 위한 서지 조사. 웹 검색과 Crossref/arXiv/PMC 페이지 확인을 거쳐 실제 존재가 확인된 문헌만 수록했다. 확인 상태 표기 기준은 다음과 같다.

- 【확인】 제목·저자·게재지·연도·DOI(또는 arXiv 번호)를 발행처 또는 Crossref·PMC 기록으로 대조함.
- 【부분 확인】 논문 존재와 핵심 내용은 확인했으나 DOI·권호·저자 목록 중 일부를 1차 출처에서 대조하지 못함. 인용 전 해당 항목만 재확인하면 된다.
- 【프리프린트】 arXiv에 존재하며 내용을 확인했으나 동료심사 게재 여부가 확인되지 않음. 심사용 원고에는 "preprint"로 명시해야 한다.
- 【미확인】 서지를 확인하지 못함. 본문에는 쓰지 않는다.

기존 메모(`docs/related_work_search.md`, 2026-10-06)에 있던 Woll 2026, Wampfler 2022, Kołakowska 2020은 이번에 서지를 재확인해 아래 표에 포함했다.

우리 연구 요약(대조 기준): 스마트폰 가속도 2Hz, 30분 요약 32특징으로 각성·정서가 추정. 앞카메라 표정 계수(MediaPipe blendshape 52)를 교사(pseudo-label)로 삼아 33파라미터 로지스틱 학생 모델을 LiteRT로 1시간마다 단말에서 갱신(23~44ms). 평가 정답은 모델 상태와 무관한 무작위 시각의 Affect Grid 응답(arm B)만 사용. 학생이 기본 모델보다 뒤지면 복귀하는 성능 가드. K-EmoPhone(77명)에서 설문 응답 누적만으로는 within-user AUROC 상승 없음, 요약 창 15~30분 최적, 32특징으로 77명 식별 7%. 인터넷 권한 없는 안드로이드 앱.

---

## 1. 스마트폰·웨어러블 IMU로 일상 정서를 추정한 연구와 개인화 성능

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 1-1 | Meegahapola, L. 외 27명. "Generalization and Personalization of Mobile Sensing-Based Mood Inference Models: An Analysis of College Students in Eight Countries." Proc. ACM IMWUT 6(4), 2022(UbiComp 2023 발표, Distinguished Paper). DOI 10.1145/3569483 | 8개국 678명 329K 자기보고. 국가별·부분 개인화 모델이 최고(2분류 valence AUROC 0.78~0.98). 국가 불문 모델은 개인화해도 약함 | 같은 점: 모바일 센싱으로 valence 추론, 개인화 효과 분석. 다른 점: 다중 센서·앱 사용 로그 포함, 서버 학습. 우리가 더 나아간 점: 가속도 단일 모달·단말 내 학습·갱신 지연 측정. 과장 금지: 이들의 AUROC 범위는 우리 K-EmoPhone 결과와 조건이 다르므로 직접 비교 불가 | 【확인】 |
| 1-2 | Kang, S., Choi, W., Park, C.Y., Cha, N., Kim, A., Khandoker, A.H., Hadjileontiadis, L., Kim, H., Jeong, Y., Lee, U. "K-EmoPhone: A Mobile and Wearable Dataset with In-Situ Emotion, Stress, and Attention Labels." Scientific Data 10:351, 2023. DOI 10.1038/s41597-023-02248-2 | 77명 7일, 5,582 ESM(valence·arousal·stress·attention), 스마트폰 컨텍스트+웨어러블 생리. Zenodo 제한 공개 | 우리가 쓰는 공개 데이터 그 자체. 데이터 설명은 반드시 이 논문을 인용하고, 버전(v1.1.x, 77명)을 명시 | 【확인】 |
| 1-3 | Zhang, P., Park, M., Kang, S., Ismatzoda, T., Mustafakulov, A., Najimov, O., Choi, W., Alikhanov, J., Ghosh, S., Lee, U. "EmoPhone: A Multi-Wave Dataset for In-the-Wild Mobile and Wearable Affect Sensing." arXiv:2609.16581, 2026 | 2020~2022 3개 웨이브. 사용자 내 시계열 예측은 지도학습, 사용자 간은 도메인 적응, 웨이브 간은 도메인 일반화가 우세. "참가자 간 변동이 라벨 부족보다 더 큰 제약" | 같은 점: 같은 연구실의 후속 데이터, 우리 within-user 결론(촘촘한 피드백 필요)과 방향 일치. 다른 점: 벤치마크 논문. 활용: 우리 K-EmoPhone 결과의 외적 타당성 논의에 인용 | 【프리프린트】 |
| 1-4 | Woll, S. 외. "Predicting Momentary Mood in Daily Life from Accelerometer Data: Evaluating Single vs. Multiple Sensor Locations Using Machine Learning." Sensors 26(12):3688, 2026. DOI 10.3390/s26123688 | 259명, 64Hz 원시 가속도(엉덩이·허벅지·가슴·손목), EMA 직전 15분 창, XGBoost. 엉덩이 R² 0.38, 다중 부착 이득 없음 | 가장 가까운 일상 가속도 대비 기분 연구. 같은 점: EMA 직전 창 요약. 다른 점: 64Hz 연구용 센서, 참가자 간 교차검증. 우리가 더 나아간 점: 2Hz 폰 단일 센서, 창 길이 15~30분 최적 탐색, 온디바이스. 과장 금지: 손목·폰 위치는 이들 결과에서 가장 약한 쪽이므로 우리 성능이 낮은 이유로도 읽힌다 | 【확인】 |
| 1-5 | Wampfler, R., Klingler, S., Solenthaler, B., Schinazi, V.R., Gross, M., Kowatsch, T. "Affective State Prediction from Smartphone Touch and Sensor Data in the Wild." CHI 2022. DOI 10.1145/3491102.3501835 | 82명 10주. 타이핑 중 터치+관성 신호 히트맵을 CNN에 입력, valence AUC 0.83. 관성 신호 단독으로도 0.83. 개인화로 +0.07 AUC | 같은 점: 폰 관성 센서 단독으로 정서 추정, 개인화 이득 수치화. 다른 점: 타이핑 순간 한정, 서버 학습. 우리가 더 나아간 점: 콘텐츠 소비 중 수동 기록, 단말 학습. 과장 금지: 이들의 개인화 이득 0.07은 서버 측 재학습 결과 | 【확인】 |
| 1-6 | Zhang, X., Li, W., Chen, X., Lu, S. "MoodExplorer: Towards Compound Emotion Detection via Smartphone Sensing." Proc. ACM IMWUT 1(4), 2018. DOI 10.1145/3161414 | 30명, 폰 사용·센서 데이터와 팩터 그래프로 복합 정서 76% exact match | 초기 폰 센싱 정서 연구. 다른 점: 앱 사용 로그 중심, 범주형 정서 | 【확인】 |
| 1-7 | Servia-Rodríguez, S., Rachuri, K.K., Mascolo, C., Rentfrow, P.J., Lathia, N., Sandstrom, G.M. "Mobile Sensing at the Service of Mental Well-being: a Large-scale Longitudinal Study." WWW 2017. DOI 10.1145/3038912.3052618 | 약 18,000명 3년. 가속도·마이크 등 수동 센싱으로 긍/부정 기분 약 70%(주말) | 대규모 일상 기분 센싱의 대표 선행. 다른 점: 인구 수준 모델, 서버. 우리가 더 나아간 점: 개인 단위 갱신 | 【확인】 |
| 1-8 | Spathis, D., Servia-Rodriguez, S., Farrahi, K., Mascolo, C., Rentfrow, J. "Passive mobile sensing and psychological traits for large scale mood prediction." PervasiveHealth 2019, pp. 272-281 | 가속도·소음 수동 센싱+일회성 성격 설문. 센싱 추가로 약 5% 향상, 1주 집계가 1일보다 우세 | 집계 창 길이가 성능에 미치는 영향을 다룬 선행. 우리 15~30분 최적 결과와 시간 척도가 다름(일 대 분). DOI는 ACM DL에서 재확인 필요 | 【부분 확인】 |
| 1-9 | Sultana, M., Al-Jefri, M., Lee, J. "Using Machine Learning and Smartphone and Smartwatch Data to Detect Emotional States and Transitions: Exploratory Study." JMIR mHealth and uHealth 8(9):e17818, 2020. DOI 10.2196/17818 | 49개 정서를 6상태로 묶고 5분 단위 일반·개인화 모델. 개인화 AUROC 평균 96.3%. 모션·시공간 컨텍스트가 가장 유익 | 같은 점: 모션 특징, 개인화. 다른 점: 데이터 출처 기술이 자료마다 달라(ExtraSensory 18명 vs 자체 수집) 본문 확인 후 인용. 매우 높은 AUROC는 시간 누출 가능성 논의에 활용 | 【확인】(데이터 출처 서술은 본문 확인 필요) |
| 1-10 | Quiroz, J.C., Geangu, E., Yong, M.H. "Emotion Recognition Using Smart Watch Sensor Data: Mixed-Design Study." JMIR Mental Health 5(3):e10153, 2018. DOI 10.2196/10153 | 50명 250m 보행, 스마트워치 모션으로 개인별 분류기 중앙값 정확도 78% 이상 | 걸음 패턴 대비 정서의 개인 모델 근거. 다른 점: 실험실 유도 정서, 보행 한정 | 【확인】 |
| 1-11 | Taylor, S., Jaques, N., Nosakhare, E., Sano, A., Picard, R. "Personalized Multitask Learning for Predicting Tomorrow's Mood, Stress, and Health." IEEE Trans. Affective Computing 11(2):200-213, 2020. DOI 10.1109/TAFFC.2017.2784832 | 설문·웨어러블·폰 로그로 다음 날 기분 예측. 개인을 과제로 보는 멀티태스크 개인화가 단일 모델 대비 큰 이득 | 개인화의 필요성을 가장 널리 인용되는 형태로 보여준 논문. 다른 점: 일 단위 예측, 서버 학습 | 【확인】 |
| 1-12 | Shah, R.V., Grennan, G., Zafar-Khan, M., Alim, F., Dey, S., Ramanathan, D., Mishra, J. "Personalized machine learning of depressed mood using wearables." Translational Psychiatry 11:338, 2021. DOI 10.1038/s41398-021-01445-0 | 14명 1개월, 개인마다 최적 모델이 다름. 개인별 Shapley 결정 요인 상이 | "개인마다 모델이 달라야 한다"는 임상 측 근거. 표본 14명 한계 | 【확인】 |
| 1-13 | Kołakowska, A., Szwoch, W., Szwoch, M. "A Review of Emotion Recognition Methods Based on Data Acquired via Smartphone Sensors." Sensors 20(21):6367, 2020. DOI 10.3390/s20216367 | 10년간 75편 체계적 리뷰(카메라·마이크 제외) | 관련 연구 서두 압축 인용용 | 【확인】 |

## 2. 정서 인식의 개인화·온디바이스 학습·continual/federated personalization

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 2-1 | Yu, H., Sano, A. "Semi-Supervised Learning for Wearable-based Momentary Stress Detection in the Wild." Proc. ACM IMWUT 7(2), 2023. DOI 10.1145/3596246 | 오토인코더 사전학습+일관성 정규화, 비라벨 데이터 능동 샘플링. 지도 대비 7~10% 향상 | 같은 점: 일상 웨어러블에서 라벨 희소 문제. 다른 점: 비라벨 데이터 자체 활용(교사 모달 없음), 서버. 우리가 더 나아간 점: 교사 모달을 두어 라벨 없이 연속 갱신 | 【확인】 |
| 2-2 | Xu, X. 외. "GLOBEM: Cross-Dataset Generalization of Longitudinal Human Behavior Modeling." Proc. ACM IMWUT 6(4), 2022(arXiv:2211.02733) | 500명 이상 4개 기관-연도 데이터. 기존 9개 우울 검출 알고리즘·8개 도메인 일반화 기법 모두 교차 데이터셋 일반화 실패. 개인 간 차이가 핵심 원인 | 개인화가 필수라는 근거. DOI는 ACM DL에서 재확인 | 【부분 확인】 |
| 2-3 | Rudovic, O., Lee, J., Dai, M., Schuller, B., Picard, R.W. "Personalized machine learning for robot perception of affect and engagement in autism therapy." Science Robotics 3(19):eaao6760, 2018 | 35명 아동 다중 모달. 인구통계·행동평가로 개인화한 딥 모델이 비개인화 대비 우세 | 정서 인식 개인화의 고영향 선행. 다른 점: 로봇 치료 맥락, 오프라인 | 【부분 확인】(DOI 미대조) |
| 2-4 | Benouis, M., André, E., Can, Y.S. "Balancing Between Privacy and Utility for Affect Recognition Using Multitask Learning in Differential Privacy-Added Federated Learning Settings: Quantitative Study." JMIR Mental Health 11:e60003, 2024. DOI 10.2196/60003 | 생리신호 스트레스 인식과 신원 인식을 멀티태스크로 분리, 신원 과제에만 DP 노이즈. 정서 인식 90%, 재식별 47%로 억제 | 같은 점: 정서 모델의 재식별 위험을 수치로 다룸. 우리와의 차이: 우리는 특징 설계 자체(32특징 요약)로 식별률 7%를 보임. 주제 5에도 해당 | 【확인】 |
| 2-5 | Nandi, A., Xhafa, F. "A federated learning method for real-time emotion state classification from multi-modal streaming." Methods 204, 2022. DOI 10.1016/j.ymeth.2022.03.005 | 웨어러블 다중 모달 스트림의 실시간 연합 정서 분류(Fed-ReMECS) | 연합 정서 인식 선행. 다른 점: 서버 집계 필요 | 【확인】 |
| 2-6 | Kalpande, S., Shirke, S., Lone, H.R. "Evaluating Federated Learning for Cross-Country Mood Inference from Smartphone Sensing Data." arXiv:2602.15478, 2026 | 국가를 클라이언트로 한 특성 인식 개인화 연합 프레임워크(FedFAP) | 1-1 데이터의 연합 확장. 우리는 서버 통신 자체를 두지 않는 쪽 | 【프리프린트】 |
| 2-7 | Kwon, Y.D., Chauhan, J., Jia, H., Venieris, S.I., Mascolo, C. "LifeLearner: Hardware-Aware Meta Continual Learning System for Embedded Computing Platforms." ACM SenSys 2023. DOI 10.1145/3625687.3625804 | 메타학습+리허설+압축으로 임베디드 연속 학습. 메모리 178.7배 절감, Oracle 대비 2.8% 이내 | 온디바이스 연속 학습 시스템의 대표. 다른 점: 이미지·음성 과제, 라벨 전제. 우리는 라벨 없는 교사 신호로 갱신 | 【확인】 |
| 2-8 | Kwon, Y.D., Chauhan, J., Kumar, A., Hui, P., Mascolo, C. "Exploring System Performance of Continual Learning for Mobile and Embedded Sensing Applications." ACM/IEEE SEC 2021 | 센싱 응용 6개 데이터셋에서 정규화·리플레이 계열 연속 학습의 단말 비용 측정. 충전 중 학습 가능 | 센서 시계열 온디바이스 학습 비용을 실측한 선행. 주제 6에도 해당. DOI 재확인 | 【부분 확인】 |

## 3. 표정 등 다른 모달리티를 교사(pseudo-label)로 쓴 cross-modal self-training / weak supervision

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 3-1 | Albanie, S., Nagrani, A., Vedaldi, A., Zisserman, A. "Emotion Recognition in Speech using Cross-Modal Transfer in the Wild." ACM Multimedia 2018(arXiv:1808.05561) | 얼굴 표정 네트워크를 교사로, 라벨 없는 영상(EmoVoxCeleb)에서 음성 정서 학생을 학습. 학생은 교사보다 낮고 완전 지도에는 못 미침 | 우리 설계의 가장 직접적 원형(얼굴 교사, 다른 모달 학생). 다른 점: 음성 학생, 오프라인 대규모. 우리가 더 나아간 점: 가속도 학생, 단말 내 개인별 연속 갱신. 과장 금지: 이들도 학생이 교사를 넘지 못함을 보고하므로 우리도 교사 상한을 명시해야 한다. DOI는 ACM DL 재확인 | 【부분 확인】 |
| 3-2 | Ni, J., Sarbajna, R., Liu, Y., Ngu, A.H.H., Yan, Y. "Cross-Modal Knowledge Distillation for Vision-to-Sensor Action Recognition." ICASSP 2022, pp. 4448-4452(arXiv:2112.01849) | 영상 교사에서 가속도 학생으로 증류(VSKD). 시험 시 가속도만 사용 | 같은 점: 시각 교사, 가속도 학생, 추론 시 센서만. 다른 점: 행동 인식, 동기화된 벤치마크 데이터셋 | 【확인】 |
| 3-3 | Liu, Y., Li, G., Lin, L. "Semantics-aware Adaptive Knowledge Distillation for Sensor-to-Vision Action Recognition." IEEE Trans. Image Processing, 2021(arXiv:2009.00210) | 웨어러블 센서 교사에서 영상 학생으로의 역방향 증류(SAKDN) | 모달 간 증류가 양방향으로 성립함을 보이는 참조. 권호·DOI 재확인 | 【부분 확인】 |
| 3-4 | Moon, S. 외. "IMU2CLIP: Language-grounded Motion Sensor Translation with Multimodal Contrastive Learning." Findings of EMNLP 2023, pp. 13246-13253. DOI 10.18653/v1/2023.findings-emnlp.883 | 고정된 CLIP 영상·텍스트 인코더에 IMU 인코더를 대조학습으로 정렬 | 영상을 IMU의 교사 공간으로 쓰는 최근 흐름. 다른 점: 대조학습, 대규모 사전학습 | 【확인】 |
| 3-5 | "COMODO: Cross-Modal Video-to-IMU Distillation for Efficient Egocentric Human Activity Recognition." arXiv:2503.07259, 2025 | 고정 영상 인코더와 특징 큐로 라벨 없이 영상에서 IMU로 분포 정렬 | 라벨 없는 영상 교사라는 점에서 우리와 같은 가정. 저자 목록 재확인 | 【프리프린트】 |
| 3-6 | Tang, C.I., Perez-Pozuelo, I., Spathis, D., Brage, S., Wareham, N., Mascolo, C. "SelfHAR: Improving Human Activity Recognition through Self-training with Unlabeled Data." Proc. ACM IMWUT 5(1), 2021. DOI 10.1145/3448112 | 교사-학생 self-training+다중 과제 자기지도. F1 최대 12% 향상, 라벨 1/10로 동등 성능 | 같은 점: 교사-학생 self-training을 IMU에 적용. 다른 점: 같은 모달 내 self-training, 행동 인식 | 【확인】 |
| 3-7 | Onim, M.S.H., Kiselica, A.M., Thapliyal, H. "Emotion Detection in Older Adults Using Physiological Signals from Wearable Sensors." arXiv:2507.08167, 2025 | 40명 노인. iMotions 표정 분석(FACS) 결과를 라벨로 웨어러블 생리 회귀 모델 학습(R² 0.78). 추론 시 카메라 불필요 | 우리와 가장 닮은 설계(표정 자동 라벨, 센서 학생, 추론 시 카메라 제거). 다른 점: 생리 신호, 실험실, 오프라인 일괄 학습. 우리가 더 나아간 점: 폰 가속도, 일상, 단말 내 연속 갱신, 무작위 시각 자기보고로 별도 평가 | 【프리프린트】 |
| 3-8 | Luna-Perejón, F., Civit, M. 외. "Real-time emotion recognition pipeline in videogames using physiological signals from a wearable device and facial action labels." Neural Computing and Applications 38:580, 2026. DOI 10.1007/s00521-026-12307-5 | 25명. FaceReader 표정 행동 라벨로 EmbracePlus EDA·BVP 랜덤 포레스트 학습, 추론 50ms 미만 | 표정을 자동 라벨러로 쓴 또 하나의 사례. 라벨 잡음 모델링은 없는 것으로 보임. 저자 목록 불완전 | 【부분 확인】 |
| 3-9 | Seikavandi, M.J., Ignatenko, T., Narcizo, F.B., Burelli, P., Boldt, J.B., Dittberner, A.B. "Pseudo-Label Augmentation for Affect Sensing in Small Collaborative Groups." arXiv:2609.16077, 2026 | 희소 자기보고를 GP pseudo-label로 증강해 웨어러블 VAD SVM 학습. 그룹 격리 평가에서는 이득 소멸 | 자기보고 희소성에 pseudo-label로 대응한 최신 사례. 교훈: 평가 분할을 엄격히 하면 이득이 사라질 수 있음 | 【프리프린트】 |
| 3-10 | Saganowski, S. 외. "Emognition dataset: emotion recognition with self-reports, facial expressions, and physiology using wearables." Scientific Data 9, 2022 | 표정·웨어러블 생리·자기보고가 동기화된 공개 데이터 | 표정 교사와 센서 학생의 일치도를 외부 데이터로 점검할 때 후보. DOI 재확인 | 【부분 확인】 |

## 4. ESM/EMA 샘플링 시점의 평가 편향(model-triggered vs random prompts, 선택 편향)

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 4-1 | Lathia, N., Rachuri, K.K., Mascolo, C., Rentfrow, P.J. "Contextual dissonance: design bias in sensor-based experience sampling methods." ACM UbiComp 2013, pp. 183-192. DOI 10.1145/2493432.2493452 | 센서 트리거로 설문 시점을 고르면 행동 분포 표현이 트리거 설계에 따라 달라지는 "맥락 불일치"가 생김을 정량화 | 우리 arm B(무작위 시각) 설계의 가장 직접적 근거. 이들은 설문 시점 편향을, 우리는 그것이 모델 평가 편향으로 이어지는 문제를 다룸 | 【확인】 |
| 4-2 | van Berkel, N., Ferreira, D., Kostakos, V. "The Experience Sampling Method on Mobile Devices." ACM Computing Surveys 50(6), 2017. DOI 10.1145/3123988 | 모바일 ESM 설계 전반(신호·이벤트·구간 수반 설계) 체계적 서베이 | 표본 설계 용어와 분류 인용용 | 【확인】 |
| 4-3 | van Berkel, N., Goncalves, J., Hosio, S., Sarsenbayeva, Z., Velloso, E., Kostakos, V. "Overcoming compliance bias in self-report studies: A cross-study analysis." Int. J. Human-Computer Studies 134:1-12, 2020 | 여러 ESM 연구에서 응답 수가 참가자별로 크게 달라 응답 잘 하는 사람의 경험이 결과를 왜곡(compliance bias) | 응답 편향의 또 다른 축. 우리 평가에서도 응답률 분포를 보고해야 함. DOI 재확인 | 【부분 확인】 |
| 4-4 | Reiter, T., Schoedel, R. "Never miss a beep: Using mobile sensing to investigate (non-)compliance in experience sampling studies." Behavior Research Methods, 2023. DOI 10.3758/s13428-023-02252-9 | 592명 25,000여 관측. 응답 여부가 과거 응답률·장소 등으로 예측 가능, 즉 결측이 무작위가 아님 | 무작위 프롬프트조차 응답은 비무작위라는 점. 우리 arm B의 응답 결측 분석에 필요한 근거 | 【확인】 |
| 4-5 | Shiffman, S., Stone, A.A., Hufford, M.R. "Ecological momentary assessment." Annual Review of Clinical Psychology 4:1-32, 2008. DOI 10.1146/annurev.clinpsy.3.022806.091415 | EMA의 정의와 신호·이벤트 수반 설계의 장단 | 기본 용어 인용. DOI는 2차 출처 대조 | 【확인】 |
| 4-6 | Klasnja, P., Hekler, E.B., Shiffman, S., Boruvka, A., Almirall, D., Rabbi, M., Murphy, S.A. "Microrandomized Trials: An Experimental Design for Developing Just-in-Time Adaptive Interventions." Health Psychology 34(S):1220-1228, 2015. DOI 10.1037/hea0000305 | 개입 시점을 무작위화해 시변 효과를 인과적으로 추정하는 설계 | "시점을 무작위화해야 인과·편향 없는 추정이 된다"는 방법론 근거. 우리 arm B는 평가용 무작위화라는 점에서 유사 논리 | 【확인】 |
| 4-7 | Dudík, M., Langford, J., Li, L. "Doubly Robust Policy Evaluation and Learning." ICML 2011, pp. 1097-1104(arXiv:1103.4601) | 정책이 고른 시점(로그 데이터)만으로 새 정책을 평가할 때의 편향과 이중 강건 보정 | 모델이 고른 순간에서만 평가하면 생기는 편향(evaluation on model-selected moments)의 이론적 참조. 우리는 보정 대신 무작위 arm을 두어 문제를 회피 | 【확인】 |
| 4-8 | Russell, J.A., Weiss, A., Mendelsohn, G.A. "Affect Grid: A single-item scale of pleasure and arousal." J. Personality and Social Psychology 57(3):493-502, 1989. DOI 10.1037/0022-3514.57.3.493 | 단일 항목 쾌-각성 격자, 4개 연구로 신뢰도·수렴·판별 타당도 | 우리 정답 척도 원출처. Killgore 1998(Psychol. Rep. 83:639-642)의 특이성 한계 비판도 함께 인용 | 【확인】 |

## 5. 센서 특징의 재식별 위험과 비식별성

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 5-1 | Na, L., Yang, C., Lo, C.-C., Zhao, F., Fukuoka, Y., Aswani, A. "Feasibility of Reidentifying Individuals in Large National Physical Activity Data Sets From Which Protected Health Information Has Been Removed With Use of Machine Learning." JAMA Network Open 1(8):e186040, 2018. DOI 10.1001/jamanetworkopen.2018.6040 | NHANES 7일 가속도를 20분 집계해도 랜덤 포레스트로 성인 94%, 아동 86% 재식별 | 집계 활동 데이터조차 식별 가능하다는 가장 강한 경고. 우리 32특징 30분 요약의 식별률 7%(77명)는 이와 대비되는 결과이므로 조건 차이(특징 수, 기간, 인구통계 결합 여부)를 명시해야 함 | 【확인】 |
| 5-2 | Neverova, N., Wolf, C., Lacey, G., Fridman, L., Chandra, D., Barbello, B., Taylor, G. "Learning Human Identity from Motion Patterns." IEEE Access 4:1810-1820, 2016. DOI 10.1109/ACCESS.2016.2557846 | 1,500명 수개월 폰 모션으로 신원 학습(Google Abacus) | 원시 모션은 생체 인증 수준의 식별자라는 근거 | 【확인】 |
| 5-3 | Zou, Q., Wang, Y., Wang, Q., Zhao, Y., Li, Q. "Deep Learning-Based Gait Recognition Using Smartphones in the Wild." IEEE Trans. Information Forensics and Security, 2020(arXiv:1811.00338) | 118명 폰 보행 데이터, CNN+RNN으로 식별 93.5% | 원시 가속도의 재식별력. 권호·DOI 재확인, 버전 간 저자 목록 차이 주의 | 【부분 확인】 |
| 5-4 | Kröger, J.L., Raschke, P., Bhuiyan, T.R. "Privacy Implications of Accelerometer Data: A Review of Possible Inferences." ICCSP 2019. DOI 10.1145/3309074.3309076 | 가속도에서 위치·활동·건강·신원 등 추론 가능성 메타 리뷰 | "가속도는 민감하지 않다"는 통념 반박. 우리 비식별성 분석 동기 | 【확인】 |
| 5-5 | Malekzadeh, M., Clegg, R.G., Cavallaro, A., Haddadi, H. "Mobile Sensor Data Anonymization." ACM/IEEE IoTDI 2019, pp. 49-58. DOI 10.1145/3302505.3310068 | 단말 내 오토인코더 변환으로 활동 인식 92% 유지, 신원 식별 7% 미만 | 같은 점: 단말 내 처리로 식별률을 낮춤, 결과 수치(7%)가 우리와 비슷. 다른 점: 별도 변환 모델 학습 필요. 우리는 요약 특징 설계 자체로 달성 | 【확인】 |
| 5-6 | Benouis 외 2024(2-4 참조) | 멀티태스크 DP 연합학습으로 재식별 47% | 정서 모델 맥락의 재식별 수치 비교 대상 | 【확인】 |

## 6. 온디바이스 학습 프레임워크(LiteRT/TFLite, ExecuTorch 등)와 센서 시계열 적용

| # | 서지 | 한 줄 요지 | 우리와의 관계 | 확인 |
|---|---|---|---|---|
| 6-1 | TensorFlow 팀. "On-device training in TensorFlow Lite." TensorFlow Blog, 2021-11. https://blog.tensorflow.org/2021/11/on-device-training-in-tensorflow-lite.html | 단일 모델 다중 시그니처(train/infer)와 체크포인트로 안드로이드 단말 학습 지원(TF 2.7+) | 우리 구현의 기반 API. 공식 문서이므로 각주 또는 URL 인용 | 【확인】 |
| 6-2 | "ExecuTorch: A Unified PyTorch Solution to Run AI Models On-Device." arXiv:2605.08195, 2026 | 전·후진 그래프를 함께 낮춰 단말 학습 지원, CIFAR-10 미세조정을 안드로이드에서 검증 | LiteRT 대안의 공식 기술 보고. 저자 목록 재확인 | 【프리프린트】 |
| 6-3 | Cai, H., Gan, C., Zhu, L., Han, S. "TinyTL: Reduce Memory, Not Parameters for Efficient On-Device Learning." NeurIPS 2020 | 가중치 고정·바이어스만 학습해 활성 메모리 최대 6.5배 절감 | 소수 파라미터만 갱신하는 우리 33파라미터 설계의 이론적 친척 | 【확인】 |
| 6-4 | Lin, J., Zhu, L., Chen, W.-M., Wang, W.-C., Gan, C., Han, S. "On-Device Training Under 256KB Memory." NeurIPS 2022(arXiv:2206.15472) | 희소 갱신+Tiny Training Engine으로 MCU 학습 | 극저자원 단말 학습의 기준점 | 【확인】 |
| 6-5 | Qu, Z., Zhou, Z., Tong, Y., Thiele, L. "p-Meta: Towards On-device Deep Model Adaptation." KDD 2022. DOI 10.1145/3534678.3539293 | 구조별 부분 갱신으로 단말 적응 메모리 2.5배 절감 | 부분 갱신 설계 참조 | 【확인】 |
| 6-6 | Kwon 외 SEC 2021(2-8), LifeLearner SenSys 2023(2-7) | 센서 시계열 연속 학습의 단말 비용 실측 | 우리 23~44ms 갱신 시간을 비교할 때의 참조 | 【확인】/【부분 확인】 |
| 6-7 | Kang, P., Moosmann, J., Liu, M., Zhou, B., Magno, M., Lukowicz, P., Bian, S. "Bridging Generalization and Personalization in Human Activity Recognition via On-Device Few-Shot Learning." arXiv:2508.15413, 2025 | GAP9 MCU에서 분류기 층만 소수 샷으로 갱신, 3.7~17.4% 향상 | 같은 점: 일반 표현+단말 내 경량 분류기 갱신. 다른 점: 라벨 샘플 필요, 행동 인식 | 【프리프린트】 |
| 6-8 | Saha, B., Samanta, R., Ghosh, S.K., Roy, R.B. "Towards Sustainable Personalized On-Device Human Activity Recognition with TinyML and Cloud-Enabled Auto Deployment." arXiv:2409.00093, 2024 | 손목 IMU 1D-CNN 개인화 미세조정으로 37% 향상, TinyML 배포 | 센서 개인화의 이득 크기 참조 | 【프리프린트】 |
| 6-9 | "Continual Learning at the Edge: Real-Time Training on Smartphone Devices." arXiv:2105.13127, 2021; "Continual Learning on the Edge with TensorFlow Lite." arXiv:2105.01946, 2021 | 안드로이드 네이티브 연속 학습(AR1*)과 TF Lite 리플레이 버퍼 구현 | TF Lite 기반 단말 학습의 초기 사례(이미지). 저자 목록 재확인 | 【부분 확인】 |

집계: 표에 수록한 고유 문헌 49건(교차 참조 행 2건 제외). 이 중 【확인】 31건, 【부분 확인】 10건, 【프리프린트】 8건. 【미확인】으로 남긴 서지는 없다(서지가 확인되지 않은 후보는 표에서 제외했다). 【부분 확인】 항목은 모두 "존재와 내용은 확인, DOI·권호·저자 일부만 미대조"이므로 투고 전 ACM DL·IEEE Xplore에서 해당 필드만 채우면 된다.

---

## 우리 연구의 위치

1. 가속도 단일 모달 정서 추정. 폰·웨어러블 IMU로 일상 정서를 읽는 연구는 이미 대규모(Servia-Rodríguez 2017, Meegahapola 2022)와 고해상도(Woll 2026)로 존재하며, 관성 신호 단독으로 AUC 0.83(Wampfler 2022)까지 보고된다. 우리의 기여는 성능이 아니라 조건에 있다: 2Hz, 30분 요약, 32특징이라는 극저해상도·저차원 입력으로 어디까지 가능한지와 요약 창 15~30분 최적이라는 설계 수치다. 과장하면 안 되는 지점: 우리 AUROC는 이들보다 낮고, 폰 위치는 Woll 2026에서 가장 약한 손목과 가까우므로 "경쟁 성능"으로 쓰면 안 된다.

2. 개인화와 온디바이스 학습. 개인화 필요성은 Taylor 2020, GLOBEM 2022, Meegahapola 2022가 확립했고, 단말 내 연속 학습 시스템은 LifeLearner 2023 등이 있다. 우리는 이 둘을 라벨 없이 잇는다: 자기보고 라벨 없이 교사 신호만으로 1시간마다 단말 안에서 갱신하고, 기본 모델로의 복귀 가드를 둔다. K-EmoPhone에서 설문 응답 누적만으로는 within-user AUROC가 오르지 않았다는 음성 결과는 EmoPhone 2026의 "참가자 간 변동이 라벨 부족보다 큰 제약"이라는 결론과 방향이 같으므로, 실패가 아니라 "촘촘한 피드백 없이는 개인화가 안 된다"는 근거로 위치시킨다. 과장 금지: 개인화 이득의 크기를 K-EmoPhone에서 보이지 못했으므로 "개인화로 성능이 오른다"고 쓰면 안 되고 "개인화 경로를 단말 안에서 닫았다"로 써야 한다.

3. 표정 교사의 cross-modal weak supervision. 얼굴 표정을 교사로 다른 모달 학생을 학습시키는 구조는 Albanie 2018(음성)이 원형이고, 표정 자동 라벨로 웨어러블 생리 모델을 학습한 Onim 2025, Luna-Perejón 2026이 가장 가깝다. 우리가 더 나아간 점은 (a) 학생이 가속도, (b) 학습이 단말 안에서 연속, (c) 교사와 독립된 무작위 시각 자기보고로 평가하는 세 가지다. 과장 금지: Albanie 2018이 보고한 대로 학생은 교사 상한을 넘기 어렵고, 표정 계수 자체가 정서의 잡음 섞인 대리 지표라는 점(체계적 리뷰들이 지적)을 한계에 명시해야 한다. 표정 교사의 타당도(표정 계수 대비 Affect Grid 일치)를 수치로 보여야 리뷰어가 받아들인다.

4. 평가 시점의 선택 편향. 센서 트리거 ESM이 표본 분포를 왜곡한다는 것은 Lathia 2013이 정량화했고, 응답 자체가 비무작위라는 것은 van Berkel 2020, Reiter 2023이 보였다. 모델이 고른 순간에서만 평가하면 생기는 편향은 off-policy evaluation(Dudík 2011)과 micro-randomized trial(Klasnja 2015)에서 다루는 문제와 같은 구조다. 우리 arm B(무작위 시각 Affect Grid만을 정답으로)는 이 문제를 보정이 아닌 설계로 피한다는 점에서 명확한 방법론적 기여로 읽힌다. 과장 금지: 무작위 프롬프트여도 응답 결측은 비무작위이므로(Reiter 2023) 응답률과 결측 패턴을 보고해야 한다.

5. 비식별성. 집계 활동 데이터조차 94% 재식별된다는 Na 2018, 원시 모션의 식별력(Neverova 2016, Zou 2020)에 비해 우리 32특징 요약의 77명 식별률 7%는 Malekzadeh 2019의 변환 모델 없이 특징 설계만으로 비슷한 수치에 도달한 것이다. 과장 금지: 7%는 77명 폐쇄 집합·7일 데이터 조건의 수치이며, 인구통계 결합이나 장기 데이터에서는 Na 2018처럼 올라갈 수 있다. "비식별"이 아니라 "식별 정보가 적다"로 써야 한다.

---

## 관련 연구 확장 초안(논문에 바로 붙일 수 있는 단락)

### 초안 A. 모바일 센싱 기반 정서 추정과 개인화

스마트폰과 웨어러블의 수동 센싱으로 일상 정서를 추정하는 연구는 대규모 종단 연구[Servia-Rodríguez 2017; Spathis 2019]와 다국가 비교[Meegahapola 2022]로 이어졌고, 타이핑 중 관성 신호만으로 정서가 AUC 0.83을 보고한 사례도 있다[Wampfler 2022]. 최근에는 64Hz 원시 가속도로 EMA 직전 15분 창의 기분을 예측하되 다중 부착의 이득은 없음이 보고되었다[Woll 2026]. 한편 인구 수준 모델은 개인 간 차이로 일반화에 실패하며[Xu 2022], 개인화가 큰 이득을 준다는 결과가 반복된다[Taylor 2020; Shah 2021]. 다만 개인화에는 개인별 라벨이 필요하고, 자기보고 라벨은 희소하다는 점이 병목으로 남아 있다[Yu 2023; Zhang 2026]. 본 연구는 2Hz 가속도의 30분 요약이라는 저해상도 입력에서 이 병목을 라벨 없는 교사 신호와 단말 내 갱신으로 우회하는 경로를 다룬다.

### 초안 B. 모달 간 약지도와 온디바이스 학습

얼굴 표정 네트워크를 교사로 두고 다른 모달의 학생을 라벨 없이 학습시키는 구조는 음성 정서 인식에서 처음 제시되었으며, 학생이 교사의 상한을 넘기 어렵다는 점도 함께 보고되었다[Albanie 2018]. 영상에서 관성 센서로의 증류[Ni 2022; Moon 2023]와 IMU 자체의 교사-학생 self-training[Tang 2021]이 뒤따랐고, 표정 자동 분석을 라벨로 웨어러블 생리 모델을 학습해 추론 시 카메라를 제거하는 설계도 등장했다[Onim 2025; Luna-Perejón 2026]. 단말 내 학습 측면에서는 소수 파라미터만 갱신하는 방법[Cai 2020; Qu 2022]과 센서 시계열 연속 학습의 비용 실측[Kwon 2021; Kwon 2023]이 있다. 본 연구는 이 두 흐름을 결합해, 표정 계수를 교사로 33파라미터 학생을 LiteRT로 1시간마다 폰 안에서 갱신하고, 학생이 기본 모델보다 뒤지면 복귀하는 가드를 둔다.

### 초안 C. 평가 시점 편향과 비식별성

센서 트리거로 설문 시점을 고르면 수집되는 행동·정서 표본의 분포가 트리거 설계에 따라 달라진다는 점은 이미 정량화되었고[Lathia 2013], 무작위 프롬프트에서도 응답 여부가 과거 응답률과 장소로 예측된다[van Berkel 2020; Reiter 2023]. 모델이 선택한 순간에서만 성능을 재면 로그 정책 편향이 생기며, 이를 보정하는 방법[Dudík 2011]이나 시점을 무작위화하는 설계[Klasnja 2015]가 제안되었다. 본 연구는 평가용 정답을 모델 상태와 무관한 무작위 시각의 Affect Grid[Russell 1989] 응답만으로 받아 이 편향을 설계로 피한다. 또한 집계된 활동 데이터조차 높은 비율로 재식별된다는 보고[Na 2018; Kröger 2019]와 단말 내 변환으로 식별률을 7% 미만으로 낮춘 선행[Malekzadeh 2019]을 고려해, 32개 요약 특징의 식별률을 직접 측정하였다.

---

## SCI 투고 시 리뷰어가 요구할 항목 체크리스트

1. 통계 검정과 불확실성: within-user AUROC 비교(학생 대 기본 모델, 창 길이 15·30·60분)에 참가자 단위 부트스트랩 신뢰구간과 대응 검정(Wilcoxon 부호순위 또는 혼합효과 모델)을 제시하고, 다중 비교 보정을 명시할 것. "오르지 않음"이라는 음성 결과에는 등가성 검정 또는 효과 크기와 검정력을 붙일 것.
2. 베이스라인의 충분성: 다수 클래스·개인 평균(person-mean) 베이스라인, 센서 없는 시간대 특징만 쓴 베이스라인, 표정 교사 자체의 성능(교사 상한), 그리고 Wampfler 2022·Woll 2026류의 공개 구현 재현 중 적어도 하나를 같은 분할에서 비교할 것.
3. 교사 타당도: 표정 계수(blendshape) 기반 pseudo-label과 Affect Grid 자기보고의 일치도(상관, 혼동 행렬)를 보고하고, 교사가 틀릴 때 학생이 어떻게 되는지(라벨 잡음 민감도)를 분석할 것. Albanie 2018이 보고한 교사 상한 문제를 한계에 명시.
4. 데이터 누출 방지: 시간 순서를 지킨 분할(학습 창과 평가 창의 시간 중첩 금지), 개인 단위 분할, 창 중첩으로 인한 누출 점검을 서술할 것. Sultana 2020류의 매우 높은 AUROC가 누출 의심을 받는 선례를 의식.
5. 평가 시점 설계의 사전 명세: arm B 무작위 시각의 생성 규칙, 하루 프롬프트 수, 응답률·결측 패턴(시간대·활동 수준별), 결측이 비무작위일 가능성(Reiter 2023)에 대한 민감도 분석. 가능하면 사전등록(OSF 등) 또는 분석 계획의 날짜 기록.
6. 재현성과 공개: 앱 소스, 특징 추출 코드, 학습·평가 스크립트, 학습된 기본 모델 가중치, K-EmoPhone 전처리 스크립트를 공개하고, 자체 수집 데이터는 비식별 요약 특징 수준에서 공개 가능 여부를 명시할 것. 랜덤 시드와 LiteRT 버전 고정.
7. 윤리·IRB: 자체 수집 참가자 수, 동의 절차, 얼굴 영상이 단말 밖으로 나가지 않음을 입증하는 구조(인터넷 권한 없음, 원시 영상 미저장), IRB 승인 번호 또는 면제 근거. K-EmoPhone 사용 조건(제한 공개, 학술 목적) 준수 서술.
8. 비식별성 주장의 범위 한정: 77명 폐쇄 집합 식별률 7%는 인구통계 결합·장기 데이터(Na 2018)에서 달라질 수 있음을 밝히고, 개방 집합 또는 다른 공개 데이터셋에서의 재식별 실험을 추가하거나 한계로 적을 것.
9. 온디바이스 비용의 재현 가능한 측정: 기기 모델·OS·배터리 상태, 갱신 1회당 지연(23~44ms)의 측정 방법과 반복 횟수, 에너지(배터리 소모율), 메모리 사용량. 가능하면 2종 이상의 기기.
10. 성능 가드의 정당화: 학생이 기본 모델보다 뒤지는지 판정하는 기준(어떤 데이터로, 어떤 지표로, 몇 표본 이상에서), 거짓 복귀·거짓 유지 비율, 가드가 없을 때와의 비교.
11. 일반화 범위의 명시: 대학생 중심 표본(K-EmoPhone), 안드로이드 한정, 콘텐츠 소비 맥락 한정, 한국 표본의 문화적 특이성(Meegahapola 2022가 국가 효과를 보고). 용어는 "추정(estimation)"으로 통일하고 "인식(recognition)"이나 "감지(detection)"로 과장하지 않을 것.
12. 보고 표준: 머신러닝 임상·행동 연구 보고 지침(TRIPOD-AI 또는 CONSORT-AI 성격의 체크리스트) 중 해당 항목을 부록으로 첨부하면 심사 대응이 쉬워진다.
