식약처 식품영양성분 DB를 앱 자산으로 만든 `foods.tsv.gz` 가 여기 들어간다.

```
cd app
DATA_GO_KR_KEY=<공공데이터포털 일반 인증키(Decoding)> dart run tool/food_db/build_food_db.dart --sample   # 첫 페이지로 열 확인
DATA_GO_KR_KEY=... dart run tool/food_db/build_food_db.dart --api
```

파일이 없으면 앱은 음식 검색만 비고, 사진 기록과 직접 입력은 그대로 된다.
