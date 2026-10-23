# 아쿠아 도감 (코엑스 아쿠아리움 어종 탐사 앱)

수조에 폰 카메라를 대면 물고기를 실시간 인식하고, 조준을 유지하면 포획해 도감을 채우는 PWA.
작전 문서: [docs/PLAN.md](docs/PLAN.md)

## 실행
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 로직 테스트 (조준 추적, 클래스 매핑, 도감/경험치)
```
`.env.local`이 없으면 **데모 모드**(가짜 탐지)로 동작한다. 화면 상단에 "데모 모드"가 표시된다.

## 로보플로우 모델 연결
1. Roboflow Universe에서 어종 탐지 모델을 고른다 (모델 페이지의 `project-id/version` 확인)
2. `.env.example`을 `.env.local`로 복사하고 `ROBOFLOW_API_KEY`, `ROBOFLOW_MODEL_ID` 입력
3. 모델의 클래스명이 도감과 다르면 `src/data/species.ts`의 `aliases`(종 단위) 또는 `GROUP_ALIASES`(무리 단위)에 추가

폰 카메라는 HTTPS에서만 열린다. 현장 테스트는 배포본(Vercel 등)이나 터널(ngrok 등)로.

## 구조
| 경로 | 역할 |
|---|---|
| `src/app/api/detect/route.ts` | 로보플로우 프록시 (키는 서버에만), 키 없으면 데모 |
| `src/lib/detection/` | 로보플로우 응답 파싱, 클래스→도감 매핑, 데모 탐지기 |
| `src/lib/lockOn.ts` | 조준 유지(시간 투표): 같은 라벨 3회 연속 + 평균 확신도 0.5 이상이면 포획 가능 |
| `src/lib/collection.ts` | 도감 저장 형식, 경험치·레벨, 오늘의 탐사 |
| `src/app/scan/` | 카메라·HUD·포획 시트 |
| `src/data/species.ts` | 종·구역 데이터 (초안, 전시 여부 미검증) |
