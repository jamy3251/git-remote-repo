import 'package:meta/meta.dart';

import 'nutrients.dart';

enum MealType {
  breakfast('아침'),
  lunch('점심'),
  dinner('저녁'),
  snack('간식');

  const MealType(this.label);
  final String label;

  /// 지금 시각이면 보통 어느 끼니인지. 기록 화면의 기본값.
  static MealType at(DateTime t) {
    final h = t.hour;
    if (h >= 5 && h < 10) return breakfast;
    if (h >= 11 && h < 15) return lunch;
    if (h >= 17 && h < 21) return dinner;
    return snack;
  }
}

/// 어떻게 넣었는지. 사진은 이름이 DB 와 맞았으면 photo_db, 아니면 photo_ai(AI 추정 숫자).
enum MealSource { db, photoDb, photoAi, manual, recommended }

/// 먹은 것 한 줄.
@immutable
class MealEntry {
  const MealEntry({
    required this.id,
    required this.at,
    required this.meal,
    required this.name,
    required this.amount,
    required this.nutrients,
    required this.source,
    this.unit = 'g',
    this.foodCode,
  });

  final String id;
  final DateTime at;
  final MealType meal;
  final String name;

  /// 먹은 양. 직접 입력에서 양을 모르면 0(영양만 적음).
  final double amount;
  final String unit;
  final Nutrients nutrients;
  final MealSource source;

  /// 식약처 DB 코드. 추천 끼니의 "자주 먹는 음식"을 찾는 데 쓴다.
  final String? foodCode;

  bool get aiEstimated => source == MealSource.photoAi;

  Map<String, dynamic> toJson() => {
        'at': at.millisecondsSinceEpoch,
        'meal': meal.name,
        'name': name,
        'amount': amount,
        'unit': unit,
        'nutrients': nutrients.toJson(),
        'source': source.name,
        if (foodCode != null) 'foodCode': foodCode,
      };

  factory MealEntry.fromJson(String id, Map<String, dynamic> j) => MealEntry(
        id: id,
        at: DateTime.fromMillisecondsSinceEpoch((j['at'] as num).toInt()),
        meal: MealType.values.byName(j['meal'] as String),
        name: j['name'] as String,
        amount: (j['amount'] as num).toDouble(),
        unit: j['unit'] as String? ?? 'g',
        nutrients: Nutrients.fromJson((j['nutrients'] as Map).cast()),
        source: MealSource.values.asNameMap()[j['source']] ?? MealSource.manual,
        foodCode: j['foodCode'] as String?,
      );
}
