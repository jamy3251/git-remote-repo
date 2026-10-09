# 영상 → 루틴 추출 평가 (설계 T9, D10·D15)

1. 따라 하고 싶을 만한 운동 영상 링크를 모은다(공개·일부 공개 유튜브)
   - `routines/tune.json` 5~10개: 프롬프트·별칭 표를 고칠 때 보는 것
   - `routines/holdout.json` 5~10개: 다른 채널·다른 사람이 고른 영상. 성공 판단은 여기만
2. 영상을 직접 보고 정답을 적는다
   ```json
   [{"url": "https://youtu.be/...", "truth": [
     {"exerciseId": "squat", "sets": 5, "repsMin": 5, "repsMax": 5},
     {"exerciseId": "leg_press", "sets": 3, "repsMin": 10, "repsMax": 12}
   ]}]
   ```
   exerciseId 는 `lib/data/exercises.dart` 의 id. 영상에 없으면 sets·reps 는 null
3. `GEMINI_API_KEY=... dart run tool/eval/routine_extract_eval.dart`
   (Google AI Studio 키. 앱은 키 없이 Firebase AI Logic 으로 같은 모델을 부른다)
4. 별칭 표(`lib/routines/exercise_linker.dart`)만 고쳤으면 `--offline` 으로 저장된 응답을 다시 채점
