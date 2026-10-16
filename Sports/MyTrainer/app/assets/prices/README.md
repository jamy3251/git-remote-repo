지역 식재료 시세를 앱 자산으로 만든 `prices.json` 이 여기 들어간다. 장보기 식단(설계 N6)이 쓴다.

```
cd app
KAMIS_KEY=<인증키> KAMIS_ID=<신청 아이디> dart run tool/prices/build_prices.dart --kamis --sample   # 첫 응답 확인
KAMIS_KEY=... KAMIS_ID=... DATA_GO_KR_KEY=... dart run tool/prices/build_prices.dart --kamis --chamga
```

- KAMIS(농산물유통정보) 지역별 일일 소매가: 달걀·돼지고기·고등어·쌀·고구마·감자·바나나·채소.
- 한국소비자원 참가격 매장별 판매가: 닭가슴살·두부·그릭요거트·오트밀·식용유·땅콩.

파일이 없으면 앱은 `lib/diet/price.dart` 의 참고값(2026년 10월 어림값)을 쓰고 화면에 "참고값"으로 표시한다.
앱은 헬스장 위치에서 가장 가까운 지역 값을 쓰고, 사용자가 고친 값이 늘 먼저다.
