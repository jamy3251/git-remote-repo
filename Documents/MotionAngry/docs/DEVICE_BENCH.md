# DEVICE_BENCH — 단말 비용 측정 절차 (Phase 4, 단말 미연결로 절차·스크립트만 완성)

측정 항목: (1) 학생 학습 시간(64건·100스텝, 그리고 배치 640·2,000), (2) 모델 로드 시간, (3) 메모리(PSS), (4) 배터리(연속 센싱 1시간, 카메라 교사 포함/제외), (5) 1분 요약 계산 시간.

## 준비
- Git Bash에서 adb 경로 변환을 끈다: `export MSYS_NO_PATHCONV=1` (S3_NOTES 함정).
- adb: `C:\Users\User\AppData\Local\Android\Sdk\platform-tools\adb.exe`. 앱 패키지 `kr.ac.seoil.motionaffect`.
- 단말은 USB 연결 시 ContactGate가 충전으로 판정해 추정을 보류하므로, 배터리 측정은 USB를 뽑고 `adb` 무선(`adb tcpip 5555` → `adb connect <ip>`)으로 한다.

## 1) 학습·로드 시간, 메모리 — 기존 프로브 명령 재사용
```bash
export MSYS_NO_PATHCONV=1
ADB="C:/Users/User/AppData/Local/Android/Sdk/platform-tools/adb.exe"
# LiteRT 학습 프로브(64건×100스텝, 3회): files/life/litert_probe.txt 에 time_ms, load_ms, mem 기록
"$ADB" shell am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd litert_probe
sleep 20
"$ADB" shell run-as kr.ac.seoil.motionaffect cat files/life/litert_probe.txt   # 또는 외부 저장소 경로(앱 버전에 따라)
# 메모리(PSS) 스냅샷: 서비스 가동 중 1분 간격 10회
for i in $(seq 10); do "$ADB" shell dumpsys meminfo kr.ac.seoil.motionaffect | grep -E "TOTAL PSS|TOTAL:" ; sleep 60; done
```
배치 640·2,000 조건은 앱의 `cmd litert_probe`가 64건 고정이므로, `MainActivity.litertProbe()`에 `--ei batch N` 인자를 받는 분기를 추가해야 한다(테스트 함께 추가 조건, 미구현 → 사용자 할 일).

## 2) 배터리 — 교사(카메라) 포함/제외 각 1시간, 화면 꺼짐·비충전
```bash
"$ADB" shell dumpsys batterystats --reset
# 조건 A: 교사 비활성(앱 설정 또는 prefs teacher_enabled=false), 1시간 대기
sleep 3600
"$ADB" shell dumpsys batterystats --charged kr.ac.seoil.motionaffect > results/system/batt_teacher_off.txt
"$ADB" shell dumpsys batterystats --reset
# 조건 B: 교사 활성 + 화면 사용 30분(영상 재생)
sleep 3600
"$ADB" shell dumpsys batterystats --charged kr.ac.seoil.motionaffect > results/system/batt_teacher_on.txt
```
events.csv의 `imu_stats`(배터리 %·수신 Hz)로 교차 확인한다(`src/s12_batch.py` 방식). S12에서 센서 수신율이 다른 앱에 좌우되어 배치 효과가 보이지 않았으므로, 같은 날·같은 백그라운드 앱 상태에서 A/B를 교대로 2회씩 잰다(ABAB).

## 3) 1분 요약 계산 시간
`LifeLogService`의 1분 틱에 `System.nanoTime()` 차를 `event("minute_us")`로 이미 기록한다(affect.csv `minute_us`, `estimate_us` 열). 수집된 로그에서 중앙값·p95를 보고한다:
```bash
python - <<'EOF'
import pandas as pd, glob
a = pd.concat(pd.read_csv(f) for f in glob.glob("data/raw/life/*/affect.csv"))
print(a[["minute_us", "estimate_us"]].describe(percentiles=[.5, .95]))
EOF
```
(2026-10-25 로그 360분에서 바로 계산 가능 — Phase 4 PC 결과와 함께 results/system/ 에 기록.)

## 4) PC 스케일링(단말 불필요) — `python experiments/system/scaling.py` → results/system/scaling_pc.csv

## 보고 형식
| 항목 | 조건 | 값 | 출처 파일 |
단말 측정값은 모두 `data/raw/life/<날짜>/` 원본 로그 또는 `results/system/*.txt`에서만 가져온다.
