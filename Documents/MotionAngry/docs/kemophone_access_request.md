# K-EmoPhone 접근 신청 (붙여넣기용)

Zenodo: https://zenodo.org/records/7606611

## 절차

1. **서일대 학교 메일로 Zenodo 로그인/가입.** Gmail 등 개인 메일 신청은 검토하지 않음(데이터셋 페이지 명시).
2. 데이터셋 페이지 → **Request access** → 이름·이메일·Justification 입력 → 아래 [A] 붙여넣기.
3. 사용자 동의서: tiny.cc/kemo-eula는 404(2026-10-05 확인). 원래 연결되던 구글 폼(웹 아카이브 2024-12로 확인, 현재 응답 받는 중): https://docs.google.com/forms/d/e/1FAIpQLSfmq6iAKlaNBXYMcGgM_v3Sqi4wCrTgMya_LSoEDFVEh5MmLQ/viewform — 이 양식를 **Zenodo 신청과 같은 이메일**로 작성. "For what purpose do you intend to use this data?" → 아래 [B] 붙여넣기.
4. 2026-10-07 승인. 실제 크기는 78개 파일 총 2.6GB(565GB는 잘못된 정보)라 전부 받음 → data/raw/kemophone. 다운로드는 Zenodo 개인 토큰(data/.zenodo_token.txt, git 제외) + API.

본인 확인을 빠르게 하는 데 도움 됨: 학과 홈페이지의 본인 소개, 지도교수 이름, GitHub/연구실 페이지 링크. 있으면 [A] 끝에 한 줄로 넣는다.

신청자: Jeong Mo Kang, Dept. of Information and Communication Engineering, Seoil University (전공심화 학사과정 학부생). 이메일: 202620044@seoil.ac.kr (Zenodo 가입·신청·동의서 모두 이 주소). 확인용 링크: 학과 페이지 반영 완료

---

## [A] Zenodo Justification

I am Jeong Mo Kang, an undergraduate student in the Department of Information and Communication Engineering at Seoil University, Seoul, Korea, requesting access for non-commercial academic research. The work will be submitted to the IAAI 2026 international conference hosted at Seoul National University of Science and Technology.

Research question: how much information about momentary affect (valence, arousal, stress) is carried by motion signals, and how does this depend on signal resolution? In preliminary analyses on public datasets, coarse OS-level activity labels (still/walking/running) predicted EMA affect at chance level in StudentLife (LOSO AUROC 0.49), whereas raw wrist accelerometer features in WESAD still detected stress after controlling for movement intensity (AUROC 0.83 vs 0.63 for coarse features). Both datasets are limited: StudentLife has no raw IMU data, and WESAD is a 15-person laboratory protocol in which stress is confounded with task behavior. K-EmoPhone is the only dataset I know of that combines raw wrist accelerometry with in-the-wild ESM labels, so it is needed to test whether the resolution effect holds in everyday life.

Planned analyses: (1) motion-only classification of ESM valence, arousal and stress from Band 2 accelerometer features versus smartphone activity-recognition features, with leave-one-subject-out evaluation and comparison to the baselines in Kang et al. (2023); (2) the temporal relation between affect and app-category usage; (3) using the results to design a lightweight on-device model that runs entirely on the user's phone without sending data out.

Only ESM labels, participant metadata, Band 2 accelerometer, phone activity, app usage and screen events are needed. Location, call, message and Wi-Fi data will not be used. Data will be kept on a password-protected personal computer, not shared or redistributed, no re-identification will be attempted, only aggregate results will be published, the dataset will be cited, and the data will be deleted after the project.
Department page: https://www.seoil.ac.kr/ict/index.do

---

## [B] 사용자 동의서 — "For what purpose do you intend to use this data?"

Non-commercial academic research by an undergraduate student at Seoil University (Department of Information and Communication Engineering), for a paper to be submitted to IAAI 2026 (hosted at Seoul National University of Science and Technology). I will study whether raw wrist accelerometer signals (Microsoft Band 2) carry information about momentary valence, arousal and stress in everyday life, compared with coarse smartphone activity-recognition labels. My preliminary results on public datasets suggest that the information depends on signal resolution: coarse activity labels were at chance level in StudentLife (AUROC 0.49), while raw wrist accelerometry in WESAD detected stress after controlling for movement intensity (AUROC 0.83). K-EmoPhone is needed to test this in the wild. I will train lightweight models (gradient-boosted trees) on motion features with leave-one-subject-out evaluation, analyze how affect relates in time to app-category usage, and use the findings to design an on-device model that keeps all data on the user's phone. I will use only ESM labels, participant metadata, Band 2 accelerometer, activity, app usage and screen data. I will not attempt re-identification, will not share or redistribute the data, will report only aggregate results, will cite Kang et al. (Scientific Data, 2023), and will delete the data when the project ends.

---

## 참고: [A] 한국어 번역 (제출용 아님, 내용 확인용)

서일대학교 정보통신공학과 학부생 강정모입니다. 비상업 학술 연구 목적으로 접근을 요청하며, 결과는 서울과학기술대학교에서 열리는 IAAI 2026에 제출할 예정입니다.

연구 질문: 순간 정서(정서가·각성·스트레스) 정보가 움직임 신호에 얼마나 담겨 있고, 그것이 신호 해상도에 따라 어떻게 달라지는가. 공개 데이터 사전 분석에서 OS 수준의 거친 활동 라벨은 StudentLife에서 우연 수준(AUROC 0.49)이었고, WESAD의 원시 손목 가속도는 움직임 강도를 통제한 뒤에도 스트레스를 검출했다(거친 특징 0.63 대비 0.83). 그러나 StudentLife에는 원시 IMU가 없고, WESAD는 15명 실험실 프로토콜이라 스트레스와 과제 행동이 섞여 있다. 원시 손목 가속도와 일상 환경 ESM 라벨을 함께 가진 데이터는 K-EmoPhone뿐이어서, 해상도 효과가 일상에서도 유지되는지 검증하려면 필요하다.

계획: (1) Band 2 가속도 특징 vs 폰 활동인식 특징으로 정서가·각성·스트레스 분류, 참가자 단위 교차검증, 원 논문 기준선과 비교 (2) 정서와 앱 카테고리 사용의 시간적 관계 (3) 결과를 바탕으로 데이터를 외부로 보내지 않는 경량 온디바이스 모델 설계.

필요 데이터는 ESM 라벨, 참가자 메타데이터, Band 2 가속도, 폰 활동, 앱 사용, 화면 이벤트뿐이며 위치·통화·메시지·Wi-Fi는 쓰지 않는다. 암호로 보호된 개인 PC에만 보관하고, 공유·재배포·재식별 시도를 하지 않으며, 집계 결과만 발표하고, 데이터셋을 인용하며, 프로젝트 종료 후 삭제한다.
