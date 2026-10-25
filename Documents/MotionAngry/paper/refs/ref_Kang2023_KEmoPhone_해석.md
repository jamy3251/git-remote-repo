# K-EmoPhone 논문 해석 (Kang et al., 2023)

원문 PDF: `paper/refs/ref_Kang2023_KEmoPhone.pdf` (21쪽, Nature 공식 PDF, CC BY 4.0). 읽은 날 2026-10-25.

## 1. 서지

- S. Kang, W. Choi, C. Y. Park, N. Cha, A. Kim, A. H. Khandoker, L. Hadjileontiadis, H. Kim, Y. Jeong, U. Lee, "K-EmoPhone: A Mobile and Wearable Dataset with In-Situ Emotion, Stress, and Attention Labels," *Scientific Data*, vol. 10, Article 351, 2023. doi:10.1038/s41597-023-02248-2.
- 접수 2022-08-11, 게재 확정 2023-05-18. 논문 유형은 Data Descriptor(데이터셋 기술 논문).
- 소속: KAIST(전산학부, 바이오및뇌공학과 등), Upstage, 강원대, Khalifa University, Aristotle University. 교신저자 최우혁(woohyeok.choi@kaist.ac.kr), 책임 이의진.
- 데이터: Zenodo doi:10.5281/zenodo.7606611 (논문 참고문헌 51번에는 2022년으로 표기). 수집 앱 코드 https://github.com/Kaist-ICLab/K-EmoPhone_Logger, 분석 노트북 https://github.com/Kaist-ICLab/K-EmoPhone_SupplementaryCodes.
- IRB: KAIST KH2018-42. 참가 보상 약 70 USD.

## 2. 한 줄 요약

대학생 77명이 7일간 안드로이드 폰(맥락·사용 로그와 OS 활동 인식)과 Microsoft Band 2 손목 밴드(가속도·심박·EDA 등)를 차고 하루 최대 16회 무작위 알림에 정서가·각성·스트레스·주의·방해도를 −3~+3 한 문항씩으로 답한 5,582건의 일상 라벨 데이터셋이며, 저자들은 참가자 단위 교차검증에서 이진 분류 macro F1 0.52~0.54 수준의 기준 성능만을 제시한다.

## 3. 데이터셋 구성

### 3.1 참가자와 기간

- 모집 80명(여 24, 평균 21.8세, SD 3.8, 17~38세), 교내 온라인 게시판 모집, Android 6.0 이상 폰 보유 조건.
- 밴드 수량 제한으로 세 집단이 각각 1주씩 수집: 2019-04-30~05-07 (P29~P53), 05-08~05-15 (P01~P28), 05-16~05-23 (P54~P80). 본문 한 문장은 "April 30 to May 8, 2019"라고 쓰여 있는데 이는 세 집단 일정과 맞지 않는 오기이므로 인용 시 집단별 일정을 쓰는 것이 안전하다.
- 3명 제외: P27(밴드 데이터가 같은 시각에 다른 값이 중복 기록되어 판별 불가), P59(폰 데이터 전무), P65(ESM 응답 전무). 최종 77명(여 24, 평균 21.9세, SD 3.9).
- 절차: 1시간 오프라인 설명회, 서면 동의, 사전 설문(인구통계, K-BFI-15 성격), PACO와 자체 수집 앱 설치, 밴드 지급. 다음 날부터 7일 수집. 밴드는 비주도 손목에 10시~22시 착용(그 외 시간은 충전). 하루 10회 이상 응답 요청. 실시간 모니터링은 하지 않음. 종료 후 사후 설문(PSS, PHQ-9, GHQ-12, 모두 "지난 1주"로 문구 수정).

### 3.2 ESM 문항과 척도 (Table 2)

PACO 앱으로 10시~22시 12시간 동안 하루 최대 16회, 평균 45분 간격, 최소 30분 간격의 무작위(signal-contingent) 푸시 알림. 알림은 10분 뒤 사라짐(회상 편향 축소 목적). 알림을 놓친 경우를 위해 자발 응답도 허용.

| 문항 | 원문 | 척도 |
|---|---|---|
| Q1 정서가 | My emotion right before doing this survey was | very negative (−3) ~ very positive (+3) |
| Q2 각성 | (같은 문두) | very calm (−3) ~ very excited (+3) |
| Q3 주의 | My attention level to my ongoing task right before doing this survey could be rated as | very bored (−3) ~ very engaged (+3) |
| Q4 스트레스 | My stress level right before doing this survey was | not stressed at all (−3) ~ very stressed (+3) |
| Q5 지속 시간 | My emotion that I answered above has not changed for recent __ minutes | 5, 10, 15, 20, 30, 60분 / 모름 |
| Q6 방해도 | Answering this survey disturbed my ongoing task | not disturbed at all (−3) ~ very disturbed (+3) |
| Q7 감정 변화 | How did your emotions change while you are answering the survey now? | more negative (−3) ~ more positive (+3) |

모두 7점 리커트(−3~+3)이며 한 차원에 한 문항이다. 저자들은 PANAS(20문항) 대신 Russell의 원형 모형에 따라 정서가·각성 각 1문항을 택한 이유를 응답 부담 축소로 설명한다. '주의'는 콘텐츠에 대한 주의가 아니라 알림 직전 하던 일에 대한 몰입도(지루함~몰입)이며, 방해도와 함께 interruptibility 연구용 문항이다.

### 3.3 응답 수

- 초기 5,753건, 3명 제외 후 5,582건. 참가자당 평균 72.5건(SD 16.0), 즉 하루 약 10.4건.
- 알림 도착 10분 이내 응답 3,323건(참가자당 평균 43.7, SD 19.4). 나머지 2,259건은 자발 응답 또는 만료 후 응답(평균 29.3, SD 16.3). P71은 알림에 한 번도 답하지 않고 자발 응답만 했다.
- EsmResponse.csv의 `scheduledTime`은 자발 응답이거나 알림이 만료된 경우 비어 있다.
- 분포: 정서가 평균 0.66(SD 1.42), 각성 −0.09(1.67), 스트레스 −0.26(1.62), 주의 0.40(1.61), 방해도 −0.04(1.76), 감정 변화 −0.01(0.90). 감정 지속 시간 평균 26.39분(SD 18.06).
- 반복측정 상관(Table 3): 각성–정서가 0.386, 각성–주의 0.435, 정서가–스트레스 −0.592(본문은 −0.591), 방해도–감정 변화 −0.222. 모두 p<0.001.

### 3.4 기기와 센서

센서 데이터는 참가자별 27개 CSV(폰 17개, 밴드 10개), 총 11.7 GB(원문 표기는 "11.7 g"). 모든 파일에 Unix ms `timestamp`. 폰 앱이 밴드에 블루투스로 연결해 10시~22시만 밴드 데이터를 받고, 1시간마다 서버에 업로드.

폰(Android 6.0 이상, 자체 로거 앱):

| 파일 | 수집 방식 | 내용 |
|---|---|---|
| Connectivity | 이벤트 | 연결 여부, MOBILE/WIFI/VPN 등 |
| DataTraffic | 15초 주기 | 수신·송신 kB |
| CallEvent / MessageEvent | 이벤트 | 번호(MD5), 연락처 유형, 통화 길이, SMS/MMS, 수신/발신 |
| AppUsageEvent | 이벤트 | 앱 전경/배경 전환 등 8종, Google Play 31개 카테고리 |
| InstalledApp | 3시간 주기 | 설치 앱 목록 |
| RingerModeEvent / PowerSaveEvent / ScreenEvent(ON/OFF/UNLOCK) / OnOffEvent / ChargeEvent | 이벤트 | 상태 변화 |
| MediaEvent | 이벤트 | 사진·영상 생성 |
| Battery | 상태 변화 시 | 잔량, 온도, 상태 |
| ActivityEvent | 적응형 | Google Activity Recognition API 신뢰도 0~1: Still, Walking, Running, OnFoot, InVehicle, OnBicycle, Tilting, Unknown. 폰이 정지하면 기록 없음, 움직임이 크게 바뀌면 15초 간격 의도, 절전·화면 꺼짐에 따라 달라짐 |
| ActivityTransition | 이벤트 | ENTER/EXIT × STILL/WALKING/RUNNING/IN_VEHICLE/ON_BICYCLE 10종 |
| Location | 적응형 | 3분 또는 5m 이동 요청, 좌표는 상수 이동으로 위장 |
| WiFi | 5분 의도(OS 제한으로 실제 30분 등) | BSSID(UUID 치환), 주파수, RSSI |

폰에는 가속도·자이로 등 원시 IMU 파일이 없다. 폰 쪽 움직임 정보는 OS 활동 인식 결과(범주별 신뢰도와 전이)만 있다. Table 1의 K-EmoPhone 행에 "Bluetooth"가 폰 항목으로 적혀 있으나 Data Records의 27개 파일에는 Bluetooth 파일이 없다.

Microsoft Band 2(비주도 손목, 10시~22시):

| 파일 | 샘플링 | 내용 |
|---|---|---|
| Acceleration | "sampled at 8." (원문에 단위 누락, 문맥상 8Hz) | x, y, z (g 단위) |
| StepCount | 1Hz | 오늘 걸음, 누적 걸음 |
| Distance | 1Hz | 오늘·누적 거리(cm), pace(ms/m), speed(cm/s), motionType IDLE/WALKING/JOGGING/RUNNING |
| AmbientLight | 2Hz | 조도(lx) |
| UltraViolet | 60초 | NONE/LOW/MEDIUM/HIGH, 노출 시간 |
| HR | 1Hz | bpm |
| SkinTemperature | 1Hz | 섭씨 |
| Calorie | 1Hz | 오늘·누적 kcal |
| EDA | 5Hz | 피부 저항(kΩ) |
| RRI | 값이 바뀔 때만 | 심박 간격(ms) |

자이로스코프는 없다. 저자들은 "the actual sampling rate can differ slightly from the predefined rate owing to I/O latency"라고 적어 공칭 주파수와 실제 간격이 다를 수 있음을 인정한다.

## 4. 저자들의 기술 검증 (Technical Validation)

### 4.1 전처리와 학습 설정

- 자발 응답과 만료 후 응답 2,259건 제외(방해도 문항 취지에 맞추기 위해). 알림 응답 35건 미만인 30명의 704건 제외. 최종 47명, 2,619건으로 모델 학습.
- 라벨: 정서가·각성·스트레스·방해도를 0 초과면 HIGH, 아니면 LOW로 이진화. 분포: 정서가 1,556/1,063, 각성 1,033/1,586, 스트레스 917/1,702, 방해도 1,110/1,509 (HIGH/LOW).
- 특징 3,356개: 설문 11개, 범주형 센서 856개, 수치형 센서 2,470개(응답 시각 직전 창에서 평균·표준편차·왜도·첨도·절대차 합·구간 엔트로피·중앙값·시계열 복잡도), ESM 시간 맥락 16개, 직전 6·12·24시간 HIGH 비율 3개. 창 크기는 30초, 1분, 5분, 10분, 30분, 1시간, 3시간, 6시간.
- 손목 가속도 전처리: ACC_AXX/AXY/AXZ와 크기 ACC_MAG(세 축 제곱합의 제곱근)만 사용. 방향 제거나 고역 필터는 없다.
- LOSO 교차검증 47분할. 분할마다 L1 선형 SVM(C=0.01)으로 특징 선택(3,356개에서 약 210~246개로), 학습 폴드만 SMOTE-NC 오버샘플링, Random Forest와 XGBoost, 다수 클래스 기준선.

### 4.2 결과 (Table 6, macro F1 / 정확도)

| 라벨 | 기준선 | RF (오버샘플링 없음) | RF (있음) | XGBoost (없음) | XGBoost (있음) |
|---|---|---|---|---|---|
| 정서가 | 0.358 / 0.597 | 0.523 / 0.662 | 0.539 / 0.661 | 0.543 / 0.659 | 0.534 / 0.635 |
| 각성 | 0.364 / 0.600 | 0.499 / 0.626 | 0.534 / 0.623 | 0.532 / 0.634 | 0.529 / 0.600 |
| 스트레스 | 0.390 / 0.655 | 0.469 / 0.666 | 0.508 / 0.644 | 0.516 / 0.656 | 0.517 / 0.620 |
| 방해도 | 0.346 / 0.588 | 0.517 / 0.722 | 0.520 / 0.727 | 0.523 / 0.708 | 0.525 / 0.695 |

저자 요약 문장: "our models showed comparable performance (0.53 for valence and 0.54 for arousal) to previous models with data collected in an in-lab setting", 스트레스는 "comparable to our models' performance (i.e., 0.52)". 비교 대상은 MAHNOB-HCI(0.39/0.38, 3클래스), DEAP(0.60/0.53), Schmidt et al. 2019(스트레스 0.47). AUROC는 보고하지 않는다.

### 4.3 중요 특징 (Fig. 5)

모든 모델에서 직전 6시간·24시간의 HIGH 비율(ESM#LIK#H06, H24)이 가장 중요했다. 정서가는 신경성(BFI_NEU), 각성은 외향성(BFI_EXT)과 직전 5분 SOCIAL 앱 사용 시간, 스트레스는 직전 3시간 또는 30분의 폰 활동 인식 WALKING 지속 시간(ACT#DUR=WALKING#H03, #M30), 방해도는 PHQ와 성실성. 손목 가속도 특징은 본문에서 상위 특징으로 언급되지 않는다.

## 5. 저자가 쓴 한계와 권장 용도

한계(Limitation 절):
- MS Band 2는 2019-05-31 동반 앱 종료로 더 쓸 수 없고, Fitbit·Garmin·Apple·Empatica는 일부 모달리티가 빠져 같은 구성을 재현하려면 기기 두 대 이상이 필요하다.
- 수집 과정을 실시간 모니터링하지 않아 지시 불이행(착용 시간, 응답 수, 앱 유지)이 품질을 떨어뜨렸을 수 있다. P71이 그 예다.
- 0 기준 이진화가 불균형을 낳았고, 사용자별 평균을 기준으로 삼으면 불균형 없이 성능이 오를 수 있다고 제안한다.

권장 용도(Usage Notes): 정서 인식, 스트레스 탐지, 주의 관리(interruptibility, 방해도), 폰 사용·이동 기반 행동 패턴, ESM 응답이 감정을 바꾸는 효과 연구. 저자들은 이 데이터셋을 "a first step toward exploring candidate sensing modalities"로 위치시킨다.

## 6. 우리 연구에서 확인해야 할 사실 (a)~(e)

(a) 손목 가속도의 실제 Hz. 원문 Data Records 문장은 "Acceleration.csv: the acceleration of the wrist sampled at 8."로 끝나며 단위가 빠져 있다(PyMuPDF와 pdfplumber 두 추출기로 확인). 같은 목록의 다른 항목이 1Hz, 2Hz, 5Hz로 표기되어 있으므로 8Hz로 읽는 것이 자연스럽고, 우리가 S4에서 측정한 중앙 간격 125ms(약 8Hz)와 일치한다. 논문에는 "약 8Hz(공칭, 중앙 샘플 간격 125ms로 확인)"처럼 공칭값과 우리 측정값을 함께 쓰는 것이 정확하다. Hz 상한 8이라는 주장은 이 문장과 Band 2 사양에 근거한다.

(b) 폰 가속도 원시 신호. 없다. 폰 17개 파일 중 IMU 원시 파일은 없고, 움직임은 Google Activity Recognition API의 범주별 신뢰도(ActivityEvent)와 전이(ActivityTransition)만 있다. 따라서 K-EmoPhone에서 "폰 OS 활동"과 "손목 가속도"를 비교하는 것은 가능하지만 "폰 가속도"는 애초에 비교 대상이 될 수 없다. 한 가지 더 주의할 점은 ActivityEvent가 적응형 샘플링이라 폰이 정지하면 기록이 없다는 것이다. 30분 창에 기록이 없는 응답을 '정지'로 볼지 '결측'으로 볼지에 따라 OS 활동 특징이 달라지므로 우리 코드의 처리 방식을 논문에 한 줄 적어야 한다.

(c) ESM 응답이 가리키는 시점. Q1·Q2·Q4 문두가 모두 "right before doing this survey"이므로 라벨은 '설문 직전 순간'의 상태다. "지난 30분"을 묻는 문항은 아니다. 다만 Q5가 그 감정이 몇 분간 변하지 않았는지를 묻고 평균 26.39분(SD 18.06)이며, 저자들도 Q5를 "may be used to propagate emotion labels throughout the course of the response"라고 설명하고 자신들의 특징 창에 30분(M30)을 포함했다. 또 알림 간격이 최소 30분, 평균 45분이라 30분 창은 대개 이전 응답과 겹치지 않는다. 우리의 '응답 직전 30분 창' 근거는 "라벨이 30분을 가리킨다"가 아니라 "직전 순간의 상태가 평균 26분 지속된다고 보고되었고 저자들도 같은 창을 썼다"로 써야 정확하다.

(d) 참가자 수. 모집 80명, 3명 제외(P27, P59, P65), 공개 데이터셋 77명이 맞다. 우리가 쓴 77명은 공개 데이터셋 전체이고, 3,771건은 응답 직전 30분 손목 가속도 커버리지 50% 이상이라는 우리 기준으로 고른 부분집합이다. 저자들의 기준 성능은 이와 다른 부분집합(알림 10분 이내 응답, 알림 응답 35건 이상인 47명, 2,619건)에서 나왔다. 우리 S4 기준에는 scheduledTime 공란(자발·만료 응답) 필터가 없으므로 자발 응답이 섞여 있다. 두 부분집합이 다르다는 점을 본문에 명시해야 한다.

(e) 저자 기준 성능. 이진 분류, LOSO 47명, macro F1 기준으로 정서가 최고 0.543(XGBoost), 각성 0.534(RF 오버샘플링), 스트레스 0.517(XGBoost 오버샘플링), 방해도 0.525. 정확도는 0.60~0.73. 저자 요약은 정서가 0.53, 각성 0.54, 스트레스 0.52. 우리 지표는 AUROC이고 저자 지표는 macro F1이므로 숫자를 나란히 두고 우열을 말할 수 없다. 특징 집합도 다르다(저자는 폰·밴드·설문·시간 맥락·과거 라벨 3,356개 전부, 우리는 움직임만). 현재 main_ko.md 35행의 "macro F1 0.52~0.54 수준의 기준 성능"은 정확하며, 뒤에 "(모든 모달리티·과거 라벨 포함, 47명 2,619건)"을 덧붙이면 오해가 줄어든다.

## 7. 우리 연구와의 연결

우리는 공개 데이터셋 77명 중 응답 직전 30분 동안 손목 가속도가 절반 이상 있는 3,771건을 써서, 손목 8Hz 가속도를 4개씩 평균해 2Hz로 내린 신호에 폰과 같은 특징 계산(60초 창, 중앙값·사분위 요약)을 적용했다. 그 결과 폰 OS 활동 특징은 정서가·각성 AUROC 0.52로 우연 수준이었고(StudentLife 0.49와 일치), 손목 움직임은 각성 0.60으로 폰보다 0.08 높았으나 세기 하나로 대부분 설명되었으며 2Hz와 8Hz 차이는 없었다. 단말용 모델(4개 평균 2Hz, 50트리×잎3)은 각성 0.623, 정서가 0.587, 스트레스 0.544이고, S4의 세기 1개 특징은 정서가 0.546이다.

이 논문이 우리 주장에 주는 근거는 세 가지다. 첫째, 폰 쪽에 원시 IMU가 없고 OS 활동 인식만 있다는 사실이 "OS 활동 범주는 정서를 거의 담지 못한다"는 비교의 전제를 뒷받침한다. 둘째, 저자들의 중요 특징에서 스트레스에 폰 WALKING 지속 시간이 올라온 것은 우리 결과(스트레스에서만 OS 활동 0.54가 손목과 차이 없음)와 방향이 맞는다. 셋째, 저자들이 모든 모달리티와 과거 라벨을 넣고도 macro F1 0.52~0.54에 머문 것은 일상 ESM 라벨의 예측 상한이 낮다는 맥락을 주며, 우리의 0.60 수준을 '약하지만 데이터셋의 기준선과 같은 급'으로 해석하는 근거가 된다.

데이터셋의 한계와 우리 방식의 보완:
- 손목 밴드 움직임이라 폰을 쥔 손의 움직임이 아니다. 자이로도 없다. 우리 앱은 폰 내부 IMU(가속도·자이로, 50Hz 격자)를 폰 안에서 상시 기록하므로 '폰이 몸에서 떨어진 시간'이라는 측정 위치 문제를 콘텐츠 소비 시점에 한정해 피할 수 있다. 다만 손목 결과를 폰으로 옮길 수 있다는 보장은 없고, 이는 우리 한계 문단에 그대로 남는다.
- 8Hz 상한. 16Hz 이상의 미세 움직임은 K-EmoPhone으로 검증할 수 없다. 우리 앱은 50Hz로 기록해 8Hz로 보간하므로 같은 계산을 더 높은 주파수에서도 할 수 있다.
- 라벨이 하루 약 10건, 10시~22시에만 있고 '직전 순간'을 가리킨다. 우리는 표정 계수(52 blendshape, 이미지 저장 없음)를 프레임마다 교사 신호로 두어 조밀한 라벨을 만들고, 좋아/별로 입력과 무작위 질문을 보조 라벨로 쓴다. K-EmoPhone의 무작위 알림(signal-contingent)과 우리의 무작위 질문은 같은 성격이므로, 보완은 '무작위성'이 아니라 '표정 교사로 라벨 밀도를 높이고 콘텐츠 소비 중이라는 맥락을 고정한 것'에 있다고 써야 한다.
- 착용 시간이 하루의 약 1/3이고(우리 측정) 참가자 지시 이행이 모니터링되지 않았다. 우리 앱은 조건부 수집 없이 상시 기록하므로 공백이 생기지 않는다.

## 8. 인용 시 주의점

1. 참가자는 77명으로 쓴다. 80명은 모집 수다.
2. 손목 가속도 주파수는 "약 8Hz"로 쓰고, 원문에 단위가 빠져 있어 우리 측정(중앙 간격 125ms)으로 확인했다고 각주나 괄호로 밝힌다.
3. 저자 성능은 macro F1(과 정확도)이며 AUROC가 아니다. 우리 AUROC와 같은 표에 넣지 않는다.
4. 저자 성능의 부분집합(47명, 2,619건, 알림 10분 이내 응답만)과 우리 부분집합(77명, 3,771건, 가속도 커버리지 기준, 자발 응답 포함)은 다르다.
5. 라벨 시점은 "right before doing this survey"다. 30분 창은 특징 창이지 라벨 정의가 아니다.
6. '주의(attention)' 라벨은 콘텐츠 주의가 아니라 하던 일에 대한 몰입도다. 우리 연구에서 콘텐츠 반응과 연결할 때 혼용하지 않는다.
7. 폰에는 원시 가속도가 없다. "폰 가속도"라는 표현 대신 "폰 OS 활동 인식(Google Activity Recognition API)"으로 쓴다.
8. 연도는 2023(Scientific Data), Zenodo 데이터셋은 2022로 표기되어 있고 Table 1에도 "K-EmoPhone (2022)"로 적혀 있다. 논문 인용은 2023으로 통일한다.
9. 정서가–스트레스 상관은 Table 3의 −0.592를 쓴다(본문 −0.591과 불일치).
10. 수집 기간은 2019년 4월 30일~5월 23일(세 집단 각 1주)로 쓴다. 본문의 "April 30 to May 8"은 오기다.

## 9. 인용에 쓸 수 있는 원문 문장

- 데이터셋 개요: "This study presents K-EmoPhone, a real-world multimodal dataset collected from 77 students over seven days. This dataset contains (1) continuous probing of peripheral physiological signals and mobility data measured by commercial off-the-shelf devices, (2) context and interaction data collected from individuals' smartphones, and (3) 5,582 self-reported affect states, including emotions, stress, attention, and task disturbance, acquired by the experience sampling method." (초록)
- ESM 일정: "During a 12-hour period within regular waking hours (i.e., 10 AM–10 PM), ESM prompts appeared on the participant's smartphone as push notifications up to 16 times a day at random intervals (signal-contingent sampling). Each prompt was triggered every 45 minutes on average, and subsequent prompts were triggered at least 30 minutes apart." (Methods)
- 라벨 시점: "My emotion right before doing this survey was ... very negative (−3) ~ very positive (+3)" (Table 2)
- 감정 지속: "Their emotions lasted for 26.39 minutes on average (SD = 18.06)." (Technical Validation)
- 손목 가속도: "Acceleration.csv: the acceleration of the wrist sampled at 8." (Data Records; 단위 누락 원문 그대로)
- 폰 활동: "ActivityEvent.csv: the history of physical activities detected by Google's Activity Recognition API ... These data were collected with adaptive sampling. For example, no reading was recorded if the smartphone became stable." (Data Records)
- 제외와 최종 수: "our final dataset obtained from the remaining 77 participants (24 females) with a mean age of 21.9 (SD = 3.9; range = 17–38) included 5,582 responses to in-situ questionnaires" (Methods)
- 기준 성능: "it is noteworthy that our models showed comparable performance (0.53 for valence and 0.54 for arousal) to previous models with data collected in an in-lab setting" (Technical Validation)
- 저자 학습 부분집합: "Consequently, we used 2,619 responses from 47 participants to build machine-learning models." (Technical Validation)
