# S3 단말 측정 메모 (갤럭시 노트9 SM-N960N, Android 10, Exynos 9810, 2026-10-06)

앱: android/ (순수 Java, AGP 8.9.1 + Gradle 8.13 캐시본 + Android Studio JBR 17). INTERNET 권한 없음.
빌드: android 폴더에서 `~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle assembleRelease` (JAVA_HOME=Android Studio jbr)
모델·검증 데이터: src/export_model.py → android/app/src/main/assets (WESAD 방향무관 특징, 16Hz 18개/32Hz 19개, 트리 200개)
adb는 반드시 `-s 28115dccf9217ece` (에뮬레이터가 같이 뜰 수 있음). Git Bash에서 adb pull 시 MSYS_NO_PATHCONV=1.

## 완료
- selftest (Python과 일치): 특징 최대 상대오차 16Hz 1.4e-15 / 32Hz 2.3e-14, 확률 오차 0
- 워밍업 벤치마크(200회 중앙값/p95): 특징 16Hz 1.6/5.1ms, 32Hz 5.4/6.0ms, 추론 35~37us, 모델 로드 20~49ms, APK 291KB
- 실센서 스모크(USB 연결, 각 100초): 16Hz 요청→실제 16.7Hz, 32Hz 요청→45~49Hz(32Hz 격자로 선형보간, 안티앨리어싱 없음 — 한계로 명시)
  서비스 내 창당 특징 13~42ms(저클럭·JIT 전), 15초마다 → CPU 점유 0.3% 미만
- 모델 출력 확률은 손목→폰 도메인 차이로 의미 없음. S3는 비용 측정만 주장.

## 2026-10-09 변경
- 2Hz·8Hz 모델 추가(export_model.py, 2Hz는 32→8→2 두 단계 decimate로 K-EmoPhone과 동일). selftest도 2/8/16/32 모두 검사. 새 APK 498KB 빌드됨(미설치).
- 배터리 계획 변경: plan 0,2,8,16,32,0 × 25분 = 150분. 원칙: 상시 기록(조건부 수집 아님).
- 주의: 2Hz 요청 시 안드로이드가 더 빠르게 줄 수 있음 → windows CSV의 eff_hz 확인, 논문에 실제 수신 주파수 병기.

## 남은 일 (다음 세션)
1. 새 APK(plan 모드) 설치: adb -s ... install -r android/app/build/outputs/apk/release/app-release.apk
2. 배터리 실험: 폰 Wi-Fi 꺼져 있고 PC 유선이라 무선 adb 불가 → 앱 plan 모드로 한 번에:
   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd start --es plan 0,2,8,16,32,0 --ei seg_min 25 --es tag battery
   → 사용자가 USB 뽑고 화면 끈 채 약 150분 → 다시 꽂고 results/s3로 pull → 구간별 충전량(μAh) 기울기로 2·8·16·32Hz 증분 비용 = (조건 − hz0 기준) 계산
   (선택) 시작 전 `dumpsys batterystats --reset`, 끝나고 `dumpsys batterystats kr.ac.seoil.motionaffect`로 앱 귀속 추정치 병기
3. 메모리(PSS)는 system CSV에서, 네트워크 0은 `dumpsys package kr.ac.seoil.motionaffect | grep permission`으로 근거 제시
4. 논문 3.3.4 표 4, 3.1.2 【설계안】 해제, 표 1 단말 행 채우기

## 2026-10-13 실행
- 새 APK 설치, selftest 4개 주파수 모두 통과 (폰의 selftest_result.txt — PC로 pull 실패했음, 배터리 실험 후 다시 가져올 것): 특징 오차 ≤2.3e-14, 확률 오차 0.
  특징 추출 중앙값 2Hz 0.16ms, 8Hz 0.44ms, 16Hz 1.5ms, 32Hz 3.8ms / 추론 18~24us / 모델 로드 17~40ms.
- 배터리 실험 시작 16:29:06 (run_1791876546557_0-2-8-16-32-0_battery), batterystats reset 직후. 종료 예정 18:59.
  시작 직후 USB 연결 상태였으므로 분석 시 첫 구간의 충전 중 구간(충전량 증가)은 제외할 것.
- 16:36 새 APK(S5 시청 실험 기능 포함) 빌드됨 — 배터리 실험 끝난 뒤(18:59 이후) 설치할 것. 지금 설치하면 측정이 끊김.
- 16:46 첫 배터리 실행(0-2-8-16-32-0) 사용자 요청으로 중단, 첫 구간(기준)만 있음 → results/s3/files/aborted/
- 16:49:42 배터리 1시간 실행 시작: plan 0,2,32,0 × 15분 (run_1791877782048_0-2-32-0_battery1h). 17:50 종료 예정. 첫 1~2분은 USB 연결 상태라 제외.
- APK 54MB(MediaPipe 네이티브 라이브러리 포함) — 논문 표의 앱 크기는 측정 앱(S3) 기준으로 따로 적을 것.
- S5 시청 기능 시험(테스트 영상 1개): IMU 가속도·자이로 각 50.0Hz, 표정 프레임 약 5fps·추론 약 65~70ms. 단 얼굴 검출 0% — 폰이 책상 위라 얼굴이 화면에 없었을 가능성. 사용자가 들고 재시험 필요. 시험 기록 results/s5/test/
- 16:54 일상 기록(LifeLogService) 포함 APK 18.6MB(arm64만) 빌드 — 배터리 1시간 실험 끝난 뒤 설치.
- 17:01 사용자가 USB를 일찍 연결(첫 기준 구간 16:49~17:04 중) → 첫 기준 구간은 충전 영향 가능, 분석 시 마지막 기준 구간(17:34~17:49)을 기준으로 쓰거나 충전량 증가 구간 제외.

## 2026-10-20 배터리 1시간 결과 확인 → 비교 불가 판정
- 충전량이 0~1083s 동안 증가: 첫 기준 구간 전체와 2Hz 앞부분은 USB 연결(충전) 상태였음.
- **요청 주파수와 무관하게 실제 수신 50Hz** (windows eff_hz 중앙값 2Hz 요청 50.0, 32Hz 요청 50.0; n_events 분당 ~3000). 다른 앱/시스템이 가속도를 50Hz로 잡고 있으면 안드로이드는 가장 빠른 요청에 맞춰 줌(10-06 스모크에서는 16Hz 요청→16.7Hz였음). 즉 이 측정에서 2Hz·32Hz 차이는 센서 비용이 아니라 처리 비용뿐.
- 방전 속도: 2Hz(유효 603s) 약 740mAh/h, 32Hz 약 750mAh/h, 마지막 기준 약 385mAh/h(초반 높고 뒤로 갈수록 낮아짐) → 시간당 약 18%로 화면이 켜져 있었거나 다른 사용이 섞인 것으로 보임. 조건 통제 실패.
- 서비스 내 처리(화면 꺼짐·저클럭): 2Hz 창당 특징 0.65ms, 32Hz 32ms, 추론 약 0.43ms.
- 결론: 배터리 증분은 논문에 수치로 쓰지 않음. 처리 비용(selftest·서비스 내 지연)만 보고하고, '요청 주파수가 실제 센서 주파수를 보장하지 않음'을 한계로 적음.

## 2026-10-20 S5 일상 기록 설치·시험 (results/s5/test_life)
- 권한 4개 adb로 부여(pm grant CAMERA, appops GET_USAGE_STATS·SYSTEM_ALERT_WINDOW, cmd notification allow_listener). 시작/중지: am start ... --es cmd life_start / life_stop
- 4분 시험: IMU 가속도·자이로 각 50.0Hz(gzip 시간당 약 3MB), 표정 초당 2장·추론 10~150ms, **유튜브 사용 중 얼굴 검출 77%(167/218)**, 다른 앱 위에서도 카메라 동작 확인. 좋아 7·별로 1 기록, 앱 전환 기록 정상.
- **곡·영상 제목은 기록 안 됨**: 유튜브 앱 내 재생은 미디어 세션 메타데이터를 비워 둠(size=0). 멜론은 메타데이터를 내보내므로 될 가능성 — 실사용 데이터에서 확인. 유튜브는 앱 이름·시간으로만 연결.
- 18:38 실제 일상 기록 시작.
