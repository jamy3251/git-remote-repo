# 공개 데이터셋 조사 — RQ1(움직임→각성/정서가) 복제, RQ5(표정→자기보고 정서) 교사 타당성

확인일 2026-10-30. 각 공식 페이지를 직접 열어 확인했고(HTTP 200), 열리지 않았거나 내용을 확인하지 못한 항목은 **[TO VERIFY]**로 표시했다. 논문 본문은 Europe PMC 전문(Open Access)으로 확인했다. 아직 어느 것도 내려받거나 분석하지 않았다 — 전부 【미실시】.

용어: "in-situ" = 일상 중 ESM/EMA 자기보고, "lab" = 실험실 자극(영상 등) 후 조건별 평가. "폰 IMU" = 스마트폰 가속도/자이로 원신호 포함 여부.

---

## 1. RQ1용 — 움직임(가속도) + 정서 자기보고

| 데이터셋 (연도) | 공식 URL | N / 기간 | 가속도계 출처·샘플링 | 폰 IMU | 정서 라벨 | 접근 / 라이선스 | 확보 소요(추정) | 판정 |
|---|---|---|---|---|---|---|---|---|
| **K-EmoPhone** (Kang et al., Sci Data 2023) | https://zenodo.org/records/7606611 (DOI 10.5281/zenodo.7606611) | 77명(모집 80, P27/P59/P65 제외) / 각 7일 | 손목 MS Band 2, ACC ~8 Hz(논문 "sampled at 8" — 현재 쓰는 값과 일치), HR 1 Hz, EDA 5 Hz, 피부온, RRI; 10:00–22:00만 | ✗ (폰은 Google Activity Recognition 이벤트·GPS·앱/화면/통화 로그만) | in-situ ESM: 정서가·각성·주의·스트레스·방해 각 7점(−3~+3), 하루 최대 16회(평균 45분 간격), 총 5,582건 | Zenodo 제한 파일: 접근 요청(기관 메일·사유) + 별도 사용자 동의서, 학술용. 자체 약관(CC 아님). 577 GB | 보유 중 | **즉시 가능**(현재 사용 중) |
| **DAPPER** (Shui et al., Sci Data 2021) | https://www.synapse.org/Synapse:syn22418021 (DOI 10.7303/syn22418021) | 142명(생리신호 88명) / 평일 5일 연속 | 손목 Psychorus 밴드: **ACC 20 Hz**, PPG 20 Hz, GSR 40 Hz (주간만) | ✗ (폰은 설문 플랫폼) | in-situ ESM 하루 6회 무작위(9–23시, ≥90분 간격): PANAS 10항목 + **정서가·각성** 5점 + 맥락; 매일 밤 DRM(≥6 사건, 같은 12정서 항목) | Synapse 계정(무료) 로그인 필요. 데이터 자체 라이선스·추가 약관 [TO VERIFY — Synapse REST에 accessRequirement 없음, 로그인 후 확인] | 당일~1일 | **등록 필요(사용자 할 일)** — RQ1 복제 1순위 |
| **TILES-2018** (Mundnich et al., Sci Data 2020) | https://tiles-data.isi.edu/ (상세 /dataset2018_details, 다운로드 /download, 가입 /signup) | 212명 병원 종사자 / 10주 | Fitbit(HR·걸음·수면, 원 ACC 없음) + OMsignal 상의(HR·HRV·호흡·**몸 움직임**, 흉부; 샘플링 [TO VERIFY]) | ✗ (Jelly Pro 폰은 음성 특징·근접 기록기) | in-situ EMA 하루 2회(semi-daily): 정서(affect)·불안·스트레스·심리적 유연성·맥락 + 사전/사후 설문 | 계정 가입(이름·메일·소속·영리여부·연구목적) 후 로그인 다운로드. 사이트에 DUA·라이선스 문구 없음, 논문 인용 요구 | 수 일(승인 절차 [TO VERIFY]) | **등록 필요(사용자 할 일)** — RQ1 2순위(움직임은 흉부·집계) |
| **StudentLife** (Wang et al., UbiComp 2014) | https://studentlife.cs.dartmouth.edu/dataset.html — **점검 시 접속 거부 [TO VERIFY]**; 미러 https://zenodo.org/records/3529253 (RData, 230 MB) | 48명 / 10주 | 폰 가속도 기반 **활동 추론만**(0 정지/1 걷기/2 뛰기/3 불명, 1분 추론·3분 휴지 듀티사이클) — 원 ACC 미공개 | △ (추론 결과만) | in-situ EMA: **PAM**(사진 정서 측정기, 정서가·각성 −2~+2 격자) 9,040건, 스트레스·기분·수면 등 총 32,000건 | 공식: 공개 다운로드(tar.bz2), 라이선스 미기재. Zenodo 미러: **CC BY 4.0**, 즉시 | 즉시(미러) | **즉시 가능** — 단 움직임이 4단계 활동 범주라 RQ1 약식 복제만 |
| **LifeSnaps** (Yfantidou et al., Sci Data 2022) | https://zenodo.org/records/6832242 (DOI 10.5281/zenodo.6826682) | 71명 / 4개월(2라운드 × ≤9주) | Fitbit Sense — **원 ACC 없음**(논문 명시), 걸음·HR·HRV·수면·스트레스 점수 등 집계 | ✗ | in-situ SEMA3 하루 3회 맥락+기분(happy/rested/tense/tired/alert/sad 범주), 주 1회 PANAS·S-STAI | **CC BY 4.0**, 공개 643 MB | 즉시 | **부적합**(움직임 원신호 없음) — 기분 EMA·걸음 보조만 |
| **WESAD** (Schmidt et al., ICMI 2018) | https://ubi29.informatik.uni-siegen.de/usi/data_wesad.html (sciebo 2.5 GB 링크 정상); 미러 https://archive.ics.uci.edu/dataset/465/wesad+wearable+stress+and+affect+detection | 15명 / 1인 ~2시간 lab | 흉부 RespiBAN **ACC 700 Hz** + 손목 E4 **ACC 32 Hz** | ✗ | lab, 조건별(기저/재미/스트레스/명상): PANAS, STAI, **SAM 정서가·각성**, SSSQ | 공개 다운로드, 과학·비영리 목적, 저작자 명시 | 즉시 | **즉시 가능** — 실험실·조건 라벨이라 RQ1 파이프라인 점검용(복제는 부적합) |
| **간호사 스트레스** (Hosseini et al., Sci Data 2022) | https://datadryad.org/dataset/doi:10.5061/dryad.5hqbzkh6f | 15명 간호사 / 각 ~1주, 총 ~1,250 h | 손목 E4 **ACC 32 Hz**(각 CSV 2행에 Hz 기재) + EDA·HR·BVP·IBI·TEMP | ✗ | in-situ: 매일 폰 설문으로 스트레스 사건·**수준(0/1/2)**·원인 — 정서가/각성 없음 | **CC0**, 공개 1.16 GB | 즉시 | **즉시 가능** — 스트레스 3단계만이라 각성 대리 변수로 부분 활용 |
| **ExtraSensory** (Vaizman et al., 2017) | http://extrasensory.ucsd.edu/ (http만 열림, https 거부) | 60명 / 평균 7.6일(2.9–28.1) | **폰 ACC 40 Hz**(매분 20초) + 자이로·자력계 + **시계 ACC 25 Hz**(56명) | **✓** | 정서 라벨 **없음**(활동·맥락 51종 자기보고만) | 공개, 인용 조건 | 즉시 | **부적합**(정서 없음) — 단 폰 vs 손목 가속도 특징 대응 검증용 유일 공개 자원 |
| **SWELL-KW** (Koldijk et al., ICMI 2014) | https://cs.ru.nl/~skoldijk/SWELL-KW/Dataset.html ; 배포 https://doi.org/10.17026/DANS-X55-69ZP | 25명 / ~3 h lab | 가속도·폰 **없음**(Kinect 자세, FaceReader 표정, HRV·피부전도, 컴퓨터 로그) | ✗ | lab, 조건별(중립/메일 방해/시간 압박): NASA-TLX, RSME, **SAM 정서가·각성**, 지각 스트레스 | DANS 공개, **CC BY-NC-SA 4.0** | 즉시 | RQ1 **부적합**; RQ5 보조(아래) |
| **PhoneLab** (Buffalo) | https://www.phone-lab.org/ — **접속 불가(응답 없음) [TO VERIFY]** | — | 폰 테스트베드(IMU 가능) | ✓(추정) | 정서 라벨 없음 | 운영 종료 추정 | — | **부적합** |
| GLOBEM (Xu et al., 2022; PhysioNet v1.1 2023) — 참고 | https://physionet.org/content/globem/1.1/ | 497명(705 인-년) / 매년 10주 × 4년 | 폰 파생 특징(위치·화면·BT·통화)·Fitbit 걸음/수면만, **원 ACC 없음** | ✗ | 주 1회 EMA(PHQ-4·PSS-4·PANAS), 우울 이진 벤치마크 | PhysioNet credentialed(CITI 교육 + DUA), Credentialed Health Data License 1.5.0 | 1~2주 | **부적합**(주간 라벨·원신호 없음) |
| LAUREATE (Ubicomp/IMWUT 2023) — 참고 | https://pc.inf.usi.ch/datasets/laureate/ (DOI 10.1145/3610892) | 42명 / 13주 26회 강의 | 손목 E4(ACC 32 Hz 추정) [TO VERIFY] | ✗ | 강의별 자기보고 정서(각성·정서가로 합산), 일일 생활습관 | 페이지에 요청 절차 없음 [TO VERIFY] | 불명 | 보류 |
| EMOPAIN | — | — | — | — | 통증 표현 | — | — | **부적합**(주제 무관, 조사 생략) |

> **핵심 결론:** "스마트폰 가속도 원신호 + in-situ 정서가/각성 자기보고"를 모두 가진 공개 데이터셋은 **찾지 못했다**. 가장 근접한 것은 (i) StudentLife — 폰 가속도이지만 4단계 활동 추론만, PAM 정서가·각성 있음, (ii) ExtraSensory — 폰 ACC 40 Hz 원신호이지만 정서 라벨 없음. 둘을 함께 쓰면 "손목→폰 특징 전이" 논증(ExtraSensory의 폰·시계 동시 가속도 56명)과 "폰 유래 움직임→PAM" 약식 복제(StudentLife)를 분담할 수 있다.

---

## 2. RQ5용 — 얼굴 영상 + 정서 라벨 (교사 모델 타당성)

| 데이터셋 (연도) | 공식 URL | N / 분량 | 얼굴 영상 | 가속도 | 정서 라벨 (누가·어떻게) | 접근 / 라이선스 | 확보 소요(추정) | 판정 |
|---|---|---|---|---|---|---|---|---|
| **K-EmoCon** (Park et al., Sci Data 2020) | https://zenodo.org/records/3931963 (DOI 10.5281/zenodo.3931963) | 32명(KAIST, 16쌍 토론) / 토론 평균 10.8분, 총 173분 | **✓** 2인칭 시점 MP4, 공개 동의 **21명**(223분) | 손목 E4 **ACC 32 Hz** + BVP·EDA·TEMP, Polar H7, NeuroSky EEG | **자기보고** 각성·정서가 1–5, **5초 간격**(본인 영상 회고 평가) + 5정서 1–4 + BROMP 범주; 동일 절차로 상대방·외부 5인 평가 | Zenodo 제한: 접근 요청 + 사용자 동의서, 심사 후 승인. 라이선스 미기재 | 1~2주 | **등록 필요(사용자 할 일)** — RQ5 1순위(한국인·자연스러운 대화·자기보고·손목 ACC 동시) |
| **Emognition** (Saganowski et al., Sci Data 2022) | https://doi.org/10.7910/DVN/R9WAF4 (Harvard Dataverse) ; 절차 https://github.com/Emognition/Emognition-wearable-dataset-2020 | 43명 / 영화 클립 9정서+중립, lab | **✓** Galaxy S20 상반신 1920×1080 **60 fps** | Galaxy Watch ACC·자이로 33 Hz, E4 ACC 32 Hz, Muse 2 ACC 256 Hz | **자기보고** 클립별 9정서 1–5 + **SAM 정서가·각성·동기 1–9** | EULA(Dataverse 저장소 내) 서명 → Dataverse 계정에 연결된 **학교 메일**로 emotions@pwr.edu.pl 송부, 학술 전용 | 1~3주 | **등록 필요(사용자 할 일)** — RQ5 2순위(고프레임 얼굴 + 자기보고 + 손목 ACC) |
| **AMIGOS** (Miranda-Correa et al., TAC 2018) | https://www.eecs.qmul.ac.uk/mmv/datasets/amigos/ ; 요청 /download.html — **점검 시 503 [TO VERIFY]** | 40명 / 단편 16편 + 장편 4편, 개인·집단, lab | **✓** 정면 얼굴 + Kinect RGB·깊이 | ✗ (EEG·ECG·GSR) | **자기보고** 정서가·각성·지배·호감·친숙 1–9 + 기본정서; 외부 평가자 V/A 20초 단위 | 요청 서버에서 ID/PW 발급, 연구 전용 | 1~2주(서버 복구 후) | **등록 필요(사용자 할 일)** — RQ5 3순위 |
| **DEAP** (Koelstra et al., TAC 2012) | https://www.eecs.qmul.ac.uk/mmv/datasets/deap/ ; /download.html — **점검 시 503 [TO VERIFY]** | 32명 / 1분 뮤직비디오 40편, lab | **✓** 22명만 | ✗ (EEG 32ch + 말초) | **자기보고** 정서가·각성·지배·호감 1–9(연속 슬라이더), 친숙도 | EULA를 **영구직 교원**이 서명·스캔 송부 → ID/PW, 학술 전용 | 1~2주 | **등록 필요(지도교수 서명)** |
| **MAHNOB-HCI** (Soleymani et al., TAC 2012) | http://mahnob-db.eu/hci-tagging/ — **점검 시 404 [TO VERIFY]**; 소개 https://ibug.doc.ic.ac.uk/resources/mahnob-hci-tagging-database/ | 27명(문헌값) [TO VERIFY] / 클립 20편, lab | **✓** 6대 카메라 | ✗ (EEG·말초·시선) | **자기보고** 정서가·각성·지배·예측가능성 1–9 + 정서 키워드 | 웹 등록 + EULA(과거 절차) [TO VERIFY] | 불명 | 보류(사이트 복구 확인 후) |
| **SWELL-KW** | (위 표) | 25명 / 3 h lab | △ **FaceReader 산출 특징**(AU·정서·머리 방향) — 원 영상 공개 여부 [TO VERIFY] | ✗ | **자기보고** 조건별 SAM 정서가·각성 | CC BY-NC-SA 4.0, 즉시 | 즉시 | 보조(특징 수준 비교만) |
| **CASE** (Sharma et al., Sci Data 2019) | https://doi.org/10.6084/m9.figshare.c.4260668 (figshare, 봇 차단 403 — API로 존재 확인) | 30명 / 영상 8편, lab | **✗** (얼굴 EMG만) | ✗ | **연속 자기보고** 조이스틱 정서가·각성 **20 Hz** | 공개(CASE_full ~5 GB). 라이선스 [TO VERIFY — figshare 항목 통상 CC BY 4.0] | 즉시 | RQ5 **부적합**(얼굴 없음) — 연속 자기보고 방법론 참고 |
| **AffectNet** (Mollahosseini et al., 2017) | https://mohammadmahoor.com/pages/databases/affectnet/ (요청은 AffectNet+ 페이지 경유) | 이미지 ~1M, 수동 라벨 ~440K | 정지 이미지 | ✗ | **외부 평가자 12인**: 7범주 + 정서가·각성 — 자기보고 아님 | 연구 전용, 요청 양식 [TO VERIFY — 페이지에 링크 미노출] | 2~4주 | **부적합**(자기보고 타당성용) — 교사 사전학습·벤치마크용만 |
| **Aff-Wild2** (Kollias et al.) | https://ibug.doc.ic.ac.uk/resources/aff-wild2/ ; 절차 https://sites.google.com/view/dimitrioskollias/databases/aff-wild2 | 594 영상 ~3M 프레임, 554명, YouTube in-the-wild | 영상 | ✗ | **외부 평가자** 연속 정서가·각성 + 7표정 + 12 AU — 자기보고 아님 | EULA: 학부·석사생은 **학생용 EULA 자필 서명 + 재학 증명** 또는 지도교수가 신청, d.kollias@qmul.ac.uk, 회신 ~14일 | ~2주 | **부적합**(자기보고 타당성용) — 교사 모델 벤치마크용만 |
| **SEWA** (Kossaifi et al., 2019) | https://db.sewaproject.eu/ — **점검 시 루트 404, EULA PDF만 열림 [TO VERIFY]**; 소개 https://ibug.doc.ic.ac.uk/resources/sewa-database/ | 398–408명, 6문화권, 2인 영상통화 | 영상 | ✗ | **외부 평가자 5인** 연속 정서가·각성·호감(기본 SEWA 부분집합) — 자기보고 아님 | EULA 서명 → iBUG(Imperial)로 반송, 학술 전용 | 2~4주 | **부적합**(자기보고 아님) |
| **RECOLA** (Ringeval et al., FG 2013) | https://recola.human-ist.ch/download.html (구 diuf.unifr.ch 도메인 소멸) | 46명(문헌값) [TO VERIFY] / 원격 협업 대화 | 영상 | ✗ (ECG·EDA) | **외부 평가자 6인** 연속 정서가·각성; 자기보고 포함 여부 [TO VERIFY] | EULA — **영구직(부교수 이상) 연구자만** 신청 가능, 기관 메일·재직 증명 | 2~4주, 교수 명의 필수 | **부적합**(장벽·라벨 유형) |
| **EMOTIC** (Kosti et al., 2017/2019) | https://s3.sunai.uoc.edu/emotic/index.html ; 요청 양식 https://forms.gle/JxcNkFHfvVyGYjjc9 | 이미지 ~23K(문헌값) | 정지 이미지(맥락 포함) | ✗ | **외부 평가자** 26범주 + VAD — 자기보고 아님 | 비영리 연구·교육 전용, 양식 제출 | 1주 | **부적합** |

> **핵심 결론:** RQ5가 묻는 것은 "표정 교사 출력이 **자기보고** 정서와 맞는가"이므로 외부 평가자 라벨 데이터셋(AffectNet, Aff-Wild2, SEWA, RECOLA, EMOTIC)은 교사 모델 자체의 벤치마크일 뿐 타당성 검증에는 쓸 수 없다. 자기보고 + 얼굴 영상을 함께 가진 것은 K-EmoCon, Emognition, AMIGOS, DEAP(22명), MAHNOB-HCI, (특징 수준) SWELL-KW뿐이다.

---

## 3. 순위 요약

### (1) RQ1 복제 — 움직임 특징 → 각성/정서가

1. **DAPPER** — 손목 ACC 20 Hz, 142명 × 5일, 하루 6회 정서가·각성(5점) + PANAS. K-EmoPhone과 설계가 가장 닮았고(손목 밴드 + ESM) 샘플링은 2.5배 높다. Synapse 계정만 필요.
2. **TILES-2018** — 212명 × 10주, 하루 2회 정서·스트레스. 움직임은 OMsignal 흉부 상의(집계 지표 가능성)라 특징이 달라지지만 장기·대규모 일반화 검증에 유일.
3. **StudentLife** — 유일하게 **폰에서 나온** 움직임 신호(4단계 활동 추론)와 PAM 정서가·각성을 함께 가짐. 지금 바로 받을 수 있음(Zenodo CC BY). 복제는 "활동 범주 분포 → PAM" 수준으로 축소.
- 보조: **ExtraSensory**(폰 ACC 40 Hz + 시계 ACC 25 Hz 동시 56명 → 손목 특징이 폰 특징으로 얼마나 전이되는지 정량화, 정서 라벨 없음), **간호사 스트레스**(E4 ACC 32 Hz + 스트레스 0/1/2, CC0), **WESAD**(E4 32 Hz + SAM, lab 파이프라인 점검).
- **폰 IMU 원신호 + in-situ 정서가/각성**을 함께 가진 공개 데이터셋은 **없음** — 이것이 우리 수집의 공백 메우기 논거가 된다.

### (2) RQ5 — 표정 교사 vs 자기보고

1. **K-EmoCon** — 한국인 21명 얼굴 영상 + 본인 5초 간격 각성·정서가(1–5) + E4 ACC 32 Hz. 자연스러운 대화 상황이라 콘텐츠 소비 중 표정과 가장 가깝고, 외부 평가자 라벨도 함께 있어 "자기보고 vs 관찰자" 괴리까지 측정 가능.
2. **Emognition** — 1080p60 상반신 영상 + 클립별 SAM 정서가·각성 1–9 + Galaxy Watch ACC 33 Hz. 영상 시청(콘텐츠 소비) 패러다임이 우리 설정과 일치.
3. **AMIGOS** — 40명 정면 얼굴 + 자기보고 V/A 1–9, 외부 평가 병행. (서버 503 복구 확인 필요; 대안 **DEAP** 22명은 영구직 교원 서명.)
- 외부 평가자 전용(AffectNet, Aff-Wild2, SEWA, RECOLA, EMOTIC)은 교사 모델 선정·벤치마크용으로만 분리.

### (3) 사용자 할 일 — 사람이 직접 해야 하는 등록·동의

즉시 받을 수 있어 사람 손이 필요 없는 것: StudentLife(Zenodo 미러), LifeSnaps, WESAD, 간호사 스트레스, ExtraSensory, SWELL-KW(DANS), CASE.

| 순서 | 데이터셋 | 할 일 | 링크 | 메모 |
|---|---|---|---|---|
| 1 | **DAPPER** | Synapse 계정 생성(기관 메일 권장) → 프로젝트 열어 약관/접근 요건 동의 → 파일 다운로드 권한 확인 | 가입 https://www.synapse.org/ → https://www.synapse.org/Synapse:syn22418021 | 로그인 후 추가 DUA 유무 [TO VERIFY]. 당일 처리 예상 |
| 2 | **K-EmoCon** | Zenodo 로그인 → "Request access"(이름·기관 메일·연구 목적) + 레코드에 첨부된 사용자 동의서 작성 | https://zenodo.org/records/3931963 | K-EmoPhone과 같은 KAIST ICLab 절차. 1~2주 |
| 3 | **Emognition** | Harvard Dataverse 계정(학교 메일) 생성 → 저장소의 EULA 내려받아 서명 → emotions@pwr.edu.pl 로 학교 메일에서 송부 | https://doi.org/10.7910/DVN/R9WAF4 ; 절차 https://github.com/Emognition/Emognition-wearable-dataset-2020 | 학술 전용. 1~3주 |
| 4 | **TILES-2018** | 계정 가입(사용자명·메일·이름·소속·영리 여부·연구 목적 기술) → 로그인 후 /download | https://tiles-data.isi.edu/signup → https://tiles-data.isi.edu/download | DUA 문구 없음, 승인 대기 여부 [TO VERIFY] |
| 5 | **AMIGOS** | 요청 서버에서 ID/PW 신청(연구 전용) | https://www.eecs.qmul.ac.uk/mmv/datasets/amigos/download.html | 점검 시 503 — 복구 후 진행 |
| 6 | **DEAP** | EULA 출력·**지도교수(영구직) 서명**·스캔 → 메일 송부 → ID/PW | https://www.eecs.qmul.ac.uk/mmv/datasets/deap/download.html | 점검 시 503. 학생 본인 명의 불가 |
| 7 (선택) | Aff-Wild2 | 학생용 EULA 자필 서명 + 재학 증명 → d.kollias@qmul.ac.uk (제목 "Aff-Wild2 request by student") 또는 지도교수 신청 | https://sites.google.com/view/dimitrioskollias/databases/aff-wild2 | 교사 벤치마크용만. ~14일 |
| 8 (선택) | MAHNOB-HCI | 사이트 복구 확인 후 웹 등록 + EULA | http://mahnob-db.eu/hci-tagging/ | 점검 시 404 [TO VERIFY] |

---

## 4. 확인 방법·미확인 항목

- 직접 열어 200 확인: Zenodo(K-EmoPhone·K-EmoCon·LifeSnaps·StudentLife 미러), Synapse(DAPPER, REST API로 위키 본문 확인), TILES(상세·다운로드·가입 페이지), WESAD(ubi29 + sciebo 링크), Dryad(간호사, CC0 확인), ExtraSensory(http), SWELL-KW(cs.ru.nl + DANS DOI 해석), PhysioNet GLOBEM, Emognition(GitHub + Dataverse DOI 해석), Aff-Wild2(iBUG + Google Sites), RECOLA(human-ist), EMOTIC, AffectNet(mohammadmahoor.com/pages/databases/affectnet/), LAUREATE.
- 논문 전문(Europe PMC OA): K-EmoPhone(PMC10238385), DAPPER(PMC8239004), CASE(PMC6785543), K-EmoCon(PMC7479607), Emognition(PMC8989970), LifeSnaps(PMC9622868).
- 열리지 않음 → [TO VERIFY]: StudentLife 공식 사이트(연결 거부), QMUL AMIGOS/DEAP(503), MAHNOB-HCI(404), SEWA 루트(404), PhoneLab(무응답), figshare CASE(봇 차단 403, API로 존재만 확인). 이들은 URL을 지어내지 않고 문헌·검색에 나온 공식 주소를 그대로 적었다.
- 수치 중 "문헌값"으로 표시한 것(MAHNOB-HCI 27명, RECOLA 46명, EMOTIC ~23K)은 이번에 공식 페이지에서 재확인하지 못했다.
