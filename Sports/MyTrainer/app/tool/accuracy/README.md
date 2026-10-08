# 기구 매칭 정확도 (설계 T7, D15)

1. 사진 모으기 (헬스장에서 폰 카메라로, 사람이 나오지 않게)
   - `photos/register/<기구>/` 앱에서 등록하듯 기구당 2~3장
   - `photos/tune/<기구>/` 기록할 때처럼 찍은 찾기 사진, 기구당 3장 이상
   - `photos/holdout/<기구>/` 다른 날·다른 폰·다른 친구가 찍은 찾기 사진. 성공 판단은 여기만
   - 등록하지 않을 기구 몇 개도 tune·holdout 에만 넣는다(미등록 기구가 자동 선택되면 안 된다)
2. 임베딩: `python tool/accuracy/embed_photos.py tool/accuracy/photos tool/accuracy/embeddings.json`
   (`python -m pip install --user mediapipe==0.10.14 pillow` 필요, 앱과 같은 모델·전처리)
3. 평가: `dart run tool/accuracy/matcher_eval.dart tool/accuracy/embeddings.json`
   - tune 으로 자동 선택 임계값(자동 정답률 97% 이상인 가장 낮은 값)과 중복 경고 임계값을 제안
   - holdout 1위 정답률 85% 이상이면 통과(종료 코드 0)
4. 나온 값을 `lib/machines/matcher.dart` 의 `defaultAutoThreshold`·`defaultDuplicateThreshold` 에 넣는다

사진과 embeddings.json 은 커밋하지 않는다(헬스장 내부 사진).

# 스쿼트 반복 카운터 (설계 T8, D15)

1. 스포터 모드를 쓸 때마다 촬영자 폰에 관절 좌표 녹화가 남는다(영상 아님, 결과 화면에서 고친 횟수 = 정답)
   `adb pull /sdcard/Android/data/com.mytrainer.mytrainer/files/spotter_recordings`
2. 정답이 맞는지 한 번 더 보고 `squat/tune/`, `squat/holdout/`(다른 날·다른 폰·다른 사람)에 나눠 넣는다
3. `dart run tool/accuracy/rep_eval.dart tool/accuracy/squat` → tune 에서 각도 격자 탐색, holdout ±1회 90% 이상이면 통과
4. 나온 각도를 `lib/spotter/spotter_state.dart` 의 `repCounterConfigProvider` 에 넣는다
