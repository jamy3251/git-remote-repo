# 관련 논문 검색식 (MotionAngry)

논문 핵심 요소: [움직임 신호] × [정서·스트레스] × [스마트폰·웨어러블] + (해상도 / 온디바이스 / 교란 / 일상 환경)
넓게 → 좁게 순서. 결과가 많으면 아래 번호로 내려가고, 적으면 위로 올라간다.

## 0. 개념 블록 (조합해서 쓰는 부품)

| 블록 | 영문 |
|---|---|
| M 움직임 | accelerometer* OR "inertial sensor*" OR IMU OR gyroscope OR "motion sensor*" OR "motion data" OR "physical activity" OR "activity recognition" OR gait OR "body movement*" |
| A 정서 | emotion* OR affect* OR stress OR valence OR arousal OR mood OR anxiety OR "mental health" OR "well-being" OR wellbeing |
| D 기기 | smartphone* OR "mobile phone*" OR "mobile sensing" OR wearable* OR smartwatch* OR wrist* |
| R 해상도 | "sampling rate" OR "sampling frequency" OR downsampl* OR granularity OR "raw sensor" OR "raw signal*" OR "low-level feature*" OR "signal resolution" |
| E 온디바이스 | "on-device" OR "edge computing" OR TinyML OR "TensorFlow Lite" OR "energy consumption" OR battery OR "resource-constrained" OR "privacy-preserving" |
| C 교란 | confound* OR "motion artifact*" OR "physical activity" OR posture OR "movement intensity" OR "context-aware" |
| W 일상 | "in the wild" OR "in-the-wild" OR "free-living" OR "daily life" OR "experience sampling" OR EMA OR ESM |

---

## 1. Scopus (TITLE-ABS-KEY)

```
# 1-1 핵심 (가장 넓음)
TITLE-ABS-KEY((accelerometer* OR "inertial sensor*" OR IMU OR "motion sensor*") AND (emotion* OR affect* OR stress OR valence OR arousal OR mood) AND (smartphone* OR "mobile phone*" OR wearable* OR smartwatch* OR wrist*))

# 1-2 해상도·샘플링 (본 논문 주장과 가장 가까움)
TITLE-ABS-KEY((accelerometer* OR IMU OR "inertial sensor*" OR "motion data") AND (emotion* OR affect* OR stress) AND ("sampling rate" OR "sampling frequency" OR downsampl* OR granularity OR "raw sensor" OR "raw signal*"))

# 1-3 움직임만으로 정서 (단일 모달리티)
TITLE-ABS-KEY(("motion only" OR "accelerometer only" OR "accelerometer-based" OR "movement-based" OR "inertial data alone") AND (emotion* OR stress OR affect* OR mood))

# 1-4 일상 환경 + 모바일 정서 센싱
TITLE-ABS-KEY(("in the wild" OR "in-the-wild" OR "free-living" OR "experience sampling" OR EMA) AND (smartphone* OR wearable*) AND (emotion* OR affect* OR stress OR mood) AND (sensor* OR sensing))

# 1-5 온디바이스 정서·스트레스 인식
TITLE-ABS-KEY(("on-device" OR "edge computing" OR TinyML OR "TensorFlow Lite" OR "energy consumption" OR "privacy-preserving") AND (emotion* OR stress OR affect*) AND (recognition OR detection OR estimation) AND (smartphone* OR wearable* OR mobile))

# 1-6 교란·움직임 영향 (한계 절 근거)
TITLE-ABS-KEY((stress OR emotion* OR affect*) AND (detection OR recognition) AND (wearable* OR wrist*) AND (confound* OR "physical activity" OR "motion artifact*" OR posture) AND (accelerometer* OR EDA OR "electrodermal"))

# 1-7 데이터셋 기반 후속연구
TITLE-ABS-KEY(WESAD AND (accelerometer* OR ACC OR "wrist")) 
TITLE-ABS-KEY((StudentLife OR "K-EmoPhone" OR "ExtraSensory") AND (emotion* OR affect* OR stress OR mood))

# 1-8 응용 연결 (소비·충동구매, 선택)
TITLE-ABS-KEY((emotion* OR affect* OR stress OR arousal) AND ("impulse buying" OR "impulsive purchas*" OR "mobile shopping" OR "online shopping") AND (sensor* OR smartphone* OR "passive sensing"))
```
필터 권장: PUBYEAR > 2013, 분야 Computer Science / Engineering / Psychology.

## 2. Web of Science (TS=)

```
TS=((accelerometer* OR "inertial sensor*" OR IMU OR "motion sensor*") AND (emotion* OR affect* OR stress OR valence OR arousal) AND (smartphone* OR wearable* OR smartwatch* OR wrist*))
TS=((accelerometer* OR IMU) AND (emotion* OR stress OR affect*) AND ("sampling rate" OR "sampling frequency" OR downsampl* OR granularity))
TS=(("on-device" OR "edge" OR TinyML) AND (stress OR emotion*) AND (detection OR recognition) AND (wearable* OR smartphone*))
```

## 3. IEEE Xplore (Command Search)

```
("All Metadata":accelerometer OR "All Metadata":"inertial sensor" OR "All Metadata":IMU) AND ("All Metadata":emotion OR "All Metadata":stress OR "All Metadata":affect) AND ("All Metadata":smartphone OR "All Metadata":wearable)

("All Metadata":accelerometer) AND ("All Metadata":stress OR "All Metadata":emotion) AND ("All Metadata":"sampling rate" OR "All Metadata":"sampling frequency" OR "All Metadata":downsampling)

("All Metadata":"on-device" OR "All Metadata":TinyML OR "All Metadata":"edge") AND ("All Metadata":"stress detection" OR "All Metadata":"emotion recognition")
```

## 4. ACM Digital Library (CHI·UbiComp/IMWUT·ICMI가 핵심 학회)

```
[Abstract: accelerometer] AND [Abstract: emotion OR affect OR stress] AND [Abstract: smartphone OR wearable]
[Abstract: "mobile sensing"] AND [Abstract: affect OR mood OR "mental health"] AND [Abstract: "in the wild" OR "experience sampling"]
[All: "affective state"] AND [All: "inertial"] AND [All: smartphone]
```
출판처 필터: Proceedings of the ACM on IMWUT, CHI, UbiComp, ICMI, MobileHCI.

## 5. Google Scholar (짧게, 여러 번)

```
accelerometer emotion recognition smartphone in the wild
"inertial sensor" "affective state" smartphone
wrist accelerometer stress detection WESAD
"sampling rate" accelerometer stress detection wearable
"activity recognition" features mood prediction smartphone
"motion sensor" emotion recognition "on-device"
passive sensing affect prediction "leave-one-subject-out"
allintitle: accelerometer emotion
allintitle: smartphone sensing stress
allintitle: wearable stress detection review
```
인용 추적: 아래 논문의 "인용한 논문(Cited by)"을 열고 그 안에서 "accelerometer" / "motion"으로 재검색.
- Wampfler et al. 2022 CHI (Affective state prediction from smartphone touch and sensor data in the wild)
- Schmidt et al. 2018 ICMI (WESAD)
- Kang et al. 2023 Sci Data (K-EmoPhone)
- Wang et al. 2014 UbiComp (StudentLife)

## 6. 국내 DB (KCI · RISS · DBpia · ScienceON)

```
가속도 센서 AND (감정 OR 정서 OR 스트레스)
(스마트폰 OR 웨어러블 OR 스마트워치) AND (감정 인식 OR 스트레스 검출 OR 정서 추정)
(관성 센서 OR IMU OR 움직임) AND 감정
모바일 센싱 AND (우울 OR 정신건강 OR 기분)
(온디바이스 OR 엣지) AND (감정 인식 OR 스트레스)
WESAD
```

## 7. 리뷰 논문 먼저 찾기 (관련연구 절 압축용)

```
TITLE-ABS-KEY((review OR survey OR "systematic review") AND (emotion* OR stress OR affect*) AND (recognition OR detection) AND (wearable* OR smartphone* OR "mobile sensing"))
```
