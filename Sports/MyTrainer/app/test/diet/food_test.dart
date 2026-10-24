import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/diet/body_profile.dart';
import 'package:mytrainer/diet/food.dart';
import 'package:mytrainer/diet/food_photo.dart';
import 'package:mytrainer/diet/food_source.dart';
import 'package:mytrainer/diet/nutrients.dart';

import '../../tool/food_db/build_food_db.dart' show parseCsv;

Food food(String name, double kcal, double c, double p, double f, {String maker = '', String code = 'x'}) =>
    Food(code: code, name: name, maker: maker, per100: Nutrients(kcal: kcal, carb: c, protein: p, fat: f));

void main() {
  group('자산 한 줄', () {
    test('TSV 로 썼다 읽으면 같다(탭·줄바꿈은 공백으로)', () {
      const f = Food(
        code: 'D101',
        name: '닭가슴살\t구이',
        category: '구이류',
        maker: '',
        unit: 'g',
        per100: Nutrients(kcal: 165, carb: 0, protein: 31.02, fat: 3.6),
        servingSize: 120,
      );
      final back = Food.fromTsv(f.toTsv())!;
      expect(back.name, '닭가슴살 구이');
      expect((back.code, back.category, back.unit, back.servingSize), ('D101', '구이류', 'g', 120.0));
      expect(back.per100, const Nutrients(kcal: 165, carb: 0, protein: 31.02, fat: 3.6));
      expect(back.forAmount(200).kcal, 330);
    });

    test('칸이 모자라거나 열량이 없으면 버린다', () {
      expect(Food.fromTsv('a\tb\tc'), isNull);
      expect(Food.fromTsv('a\t이름\tc\t\tg\t\t1\t2\t3\t'), isNull);
    });
  });

  group('검색', () {
    final index = FoodIndex([
      for (final f in [
        food('닭가슴살 스테이크 갈릭맛', 150, 5, 20, 5, maker: '어느회사'),
        food('훈제 닭가슴살', 120, 2, 24, 2),
        food('닭가슴살', 109, 0, 23, 1.2),
        food('닭가슴살', 110, 0, 23, 1.3, maker: '브랜드'),
        food('쌀밥', 143, 31.5, 2.7, 0.3),
      ])
        f.toTsv(),
    ]);

    test('정확히 같음 → 앞부분 → 포함, 같은 순위면 일반 음식·짧은 이름 먼저', () {
      expect(index.search('닭가슴살').map((f) => f.label).toList(),
          ['닭가슴살', '닭가슴살 · 브랜드', '닭가슴살 스테이크 갈릭맛 · 어느회사', '훈제 닭가슴살']);
    });

    test('공백·대소문자를 무시한다', () {
      expect(index.search('닭 가슴').first.name, '닭가슴살');
      expect(index.search('  '), isEmpty);
    });

    test('exact 는 일반 음식을 먼저 준다', () {
      expect(index.exact('닭가슴살')!.maker, '');
      expect(index.exact('라면'), isNull);
    });
  });

  group('식약처 원본 → Food', () {
    test('CSV 머리말로 열을 찾고 지방산은 지방으로 잡지 않는다', () {
      final c = FoodColumns.fromHeaders(
          ['식품코드', '식품명', '식품대분류명', '영양성분함량기준량', '에너지(kcal)', '단백질(g)', '포화지방산(g)', '지방(g)', '탄수화물(g)', '제조사명', '1회 섭취참고량'])!;
      expect((c.fat, c.carb, c.protein, c.kcal, c.serving), ('지방(g)', '탄수화물(g)', '단백질(g)', '에너지(kcal)', '1회 섭취참고량'));
      expect(FoodColumns.fromHeaders(['식품명', '에너지']), isNull);
    });

    test('기준량이 100이 아니면 100 기준으로 바꾸고, 제조사 "해당없음"은 비운다', () {
      final f = foodFromRecord({
        'FOOD_CD': 'P1',
        'FOOD_NM_KR': '단백질 음료',
        'MAKER_NM': '해당없음',
        'SERVING_SIZE': '200mL',
        'Z10500': '250ml',
        'AMT_NUM1': '180',
        'AMT_NUM3': '20',
        'AMT_NUM4': '4',
        'AMT_NUM6': '16',
      }, FoodColumns.api)!;
      expect(f.unit, 'ml');
      expect(f.maker, '');
      expect(f.per100, const Nutrients(kcal: 90, carb: 8, protein: 10, fat: 2));
      expect(f.servingSize, 250);
      expect(foodFromRecord({'FOOD_NM_KR': '빈 것', 'AMT_NUM1': '-'}, FoodColumns.api), isNull);
    });

    test('검산: 열량이 맞고 상식에 맞으면 통과, 탄·단이 바뀌면 실패', () {
      final good = [
        for (var i = 0; i < 25; i++) food('음식$i', 100, 10, 10, 2.2),
        food('닭가슴살', 109, 0, 23, 1.2),
        food('쌀밥', 143, 31.5, 2.7, 0.3),
      ];
      expect(checkColumns(good).ok, isTrue);
      final swapped = [
        for (final f in good)
          Food(code: f.code, name: f.name, per100: Nutrients(kcal: f.per100.kcal, carb: f.per100.protein, protein: f.per100.carb, fat: f.per100.fat)),
      ];
      final r = checkColumns(swapped);
      expect(r.ok, isFalse);
      expect(r.anchorProblems, containsAll(['닭가슴살 탄>단', '쌀밥 단>탄']));
      final wrongFat = [for (var i = 0; i < 25; i++) food('음식$i', 100, 10, 10, 20)];
      expect(checkColumns(wrongFat).atwaterOff, 1);
    });

    test('CSV: 따옴표 안의 쉼표·줄바꿈·이중 따옴표', () {
      expect(parseCsv('a,b\r\n"x, y","say ""hi""\nok"\n\n1,2'), [
        ['a', 'b'],
        ['x, y', 'say "hi"\nok'],
        ['1', '2'],
      ]);
    });
  });

  group('목표 계산', () {
    final now = DateTime(2026, 10, 12);
    test('남 30세 180cm 80kg 보통 활동 유지: Mifflin 1780 ×1.55', () {
      final t = computeTarget(
          const BodyProfile(sex: Sex.male, birthYear: 1996, heightCm: 180, weightKg: 80, activity: Activity.moderate, goal: Goal.maintain),
          now);
      expect(t.bmr, 1780);
      expect(t.target.kcal, closeTo(2759, 0.001));
      expect(t.target.protein, 128);
      expect(t.target.fat, closeTo(2759 * 0.25 / 9, 0.001));
      expect(t.target.carb * 4 + t.target.protein * 4 + t.target.fat * 9, closeTo(t.target.kcal, 0.001));
    });

    test('감량은 기초대사량 아래로 내리지 않는다', () {
      final t = computeTarget(
          const BodyProfile(sex: Sex.female, birthYear: 2000, heightCm: 160, weightKg: 50, activity: Activity.sedentary, goal: Goal.cut),
          now);
      // BMR = 500 + 1000 - 130 - 161 = 1209, ×1.2×0.8 = 1160.6 < BMR
      expect(t.bmr, 1209);
      expect(t.target.kcal, 1209);
      expect(t.target.protein, 100);
      expect(t.reasons.any((r) => r.contains('기초대사량으로 맞춤')), isTrue);
    });

    test('증량 +10%, 단백질 1.8g/kg', () {
      final t = computeTarget(
          const BodyProfile(sex: Sex.male, birthYear: 2001, heightCm: 175, weightKg: 70, activity: Activity.light, goal: Goal.bulk),
          now);
      expect(t.target.kcal, closeTo(t.tdee * 1.1, 0.001));
      expect(t.target.protein, closeTo(126, 0.001));
    });
  });

  group('사진 응답', () {
    test('스키마가 firebase_ai 형식과 같다', () {
      expect(jsonDecode(jsonEncode(buildFoodPhotoSchema().toJson())), jsonDecode(jsonEncode(foodPhotoSchema)));
    });

    test('이름·양 없는 줄은 버리고 확신도는 0~1', () {
      final r = parseFoodPhoto('```json\n${jsonEncode({
            'isFood': true,
            'items': [
              {'name': '현미밥', 'brand': '', 'grams': 210, 'kcal': 320, 'carb': 68, 'protein': 6, 'fat': 2, 'confidence': 1.4},
              {'name': '', 'grams': 100},
              {'name': '김치', 'grams': 0},
            ],
          })}\n```');
      expect(r.single.name, '현미밥');
      expect(r.single.brand, isNull);
      expect(r.single.confidence, 1);
      expect(r.single.nutrients.kcal, 320);
    });

    test('음식이 아니거나 비면 오류', () {
      expect(() => parseFoodPhoto(null), throwsA(isA<FoodPhotoError>()));
      expect(() => parseFoodPhoto('아님'), throwsA(isA<FoodPhotoError>()));
      expect(() => parseFoodPhoto(jsonEncode({'isFood': false, 'items': []})), throwsA(isA<FoodPhotoError>()));
    });
  });
}
