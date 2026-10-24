import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import 'food.dart';
import 'food_photo.dart';
import 'meal.dart';
import 'nutrients.dart';

/// 저장 전 한 줄. 양을 바꾸면 영양이 따라 바뀐다.
///
/// DB 음식이면 DB 의 100g 값으로, AI 추정이면 AI 가 본 양 대비 비율로 환산한다.
class MealDraft {
  MealDraft.fromFood(Food this.food, {double? amount})
      : name = food.label,
        unit = food.unit,
        amount = amount ?? food.defaultAmount,
        ai = null;

  MealDraft.fromAi(PhotoFood this.ai)
      : name = ai.brand == null ? ai.name : '${ai.name} · ${ai.brand}',
        unit = 'g',
        amount = ai.grams,
        food = null;

  final Food? food;
  final PhotoFood? ai;
  final String name;
  final String unit;
  double amount;

  /// 확인 화면에서 빼기로 한 줄.
  bool skip = false;

  bool get fromDb => food != null;

  Nutrients get nutrients =>
      food != null ? food!.forAmount(amount) : ai!.nutrients * (ai!.grams <= 0 ? 0 : amount / ai!.grams);

  MealEntry toEntry(DateTime at, MealType meal, {required bool fromPhoto}) => MealEntry(
        id: const Uuid().v4(),
        at: at,
        meal: meal,
        name: name,
        amount: amount,
        unit: unit,
        nutrients: nutrients,
        source: fromDb ? (fromPhoto ? MealSource.photoDb : MealSource.db) : MealSource.photoAi,
        foodCode: food?.code,
      );
}

/// 사진 속 음식 이름이 DB 와 정확히 같으면(공백 무시) DB 값을 쓴다. AI 숫자보다 DB 가 낫다.
/// 이름이 비슷하기만 한 것은 쓰지 않는다("닭가슴살"이 "닭가슴살 샐러드"가 되면 안 된다).
MealDraft resolvePhotoFood(PhotoFood p, FoodIndex? index) {
  final f = index?.exact(p.name);
  return f == null ? MealDraft.fromAi(p) : MealDraft.fromFood(f, amount: p.grams);
}

/// 사진 고르기. 테스트에서 바꿔 끼운다.
abstract class MealPhotoSource {
  /// JPEG 바이트. 취소하면 null.
  Future<List<int>?> take({required bool camera});
}

class PickerMealPhotoSource implements MealPhotoSource {
  const PickerMealPhotoSource();

  @override
  Future<List<int>?> take({required bool camera}) async {
    // 음식 구분에는 1280px 이면 충분하고, 요청 크기가 작아야 지하에서도 덜 기다린다.
    final x = await ImagePicker().pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1280,
      maxHeight: 1280,
      imageQuality: 80,
    );
    return x == null ? null : await x.readAsBytes();
  }
}
