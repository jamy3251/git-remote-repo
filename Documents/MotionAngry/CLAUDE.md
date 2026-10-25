# MotionAngry

폰 모션 센서 + 표정 계수로 콘텐츠 소비 중 반응을 단말 안에서 읽는 온디바이스 정서 추정 연구. 설계·결정 원장은 `docs/designs/motionangry-ondevice-loop.md`, 인사이트 장부는 `docs/evolve_loop.md`, 실험 노트는 `results/S*_NOTES.md`.

## Testing

- Python (분석·통계): `python -m pytest tests`
- Android (순수 Java 로직, 기기 불필요): `cd android && gradle testReleaseUnitTest` (JAVA_HOME = Android Studio jbr, gradle 8.13 캐시본 `~/.gradle/wrapper/dists/gradle-8.13-bin/*/gradle-8.13/bin/gradle`)
- 기기 selftest(폰–Python 일치): `adb shell am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd selftest` → files/selftest_result.txt
- 수동 E2E: `docs/qa_checklist.md`

## Rules
- 상시 기록 원칙: 조건부·이벤트 기반 수집을 제안하지 않는다(배치 모드는 지연 전달일 뿐 공백 없음).
- 안 한 실험은 처음부터 【미실시】로 표시한다.
- 인사이트는 지우지 않고 `docs/evolve_loop.md` 장부에 상태만 바꾼다.
