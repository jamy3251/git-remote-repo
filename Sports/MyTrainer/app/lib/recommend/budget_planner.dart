import 'package:meta/meta.dart';

import '../diet/meal.dart';
import '../diet/nutrients.dart';
import '../diet/price.dart';
import 'meal_planner.dart';

/// 장보기 식단(설계 추가 범위 N6). 하루 목표를 맞추는 조합 중 값이 싼 것으로 일주일을 짠다.
///
/// 1. 점심·저녁에 채소 100g(1g 값이 싼 두 가지를 번갈아).
/// 2. 남은 목표를 세 끼로 나누고, 단백질 식재료 × 탄수화물 식재료 조합마다 양을 푼다(solvePair).
///    지방이 모자라면 지방 1g 값이 가장 싼 식재료(식용유 등)로 채운다(조리용 기름 15g 까지).
/// 3. 열량 ±12%, 단백질 85% 이상인 조합만 남겨 한 끼 값이 싼 순으로 정렬.
/// 4. 단백질이 겹치지 않게(닭가슴살·닭안심은 같은 무리) 가장 싼 조합의 2배 안에서 먼저 고르고, 모자라면 1.5배 안에서 탄수화물이 다른 것으로 채워 6개를 하루 세 끼에 돌려 쓴다(날마다 한 칸씩 밀어서).
/// 5. 일주일 먹는 양을 파는 단위로 올림해 장보기 목록과 실제 낼 돈을 낸다.

const vegPerMeal = 100.0;
const kcalTolerance = 0.12;
const minProteinRatio = 0.85;
/// 일주일에 돌려 쓰는 조합 수. 하루 세 끼는 이 중 이어진 셋이다.
const poolSize = 6;
const maxPriceRatio = 1.5;

/// 단백질이 다른 조합은 가장 싼 조합의 이 배수까지 쓴다(매 끼니 같은 단백질만 먹지 않게).
const varietyPriceRatio = 2.0;

@immutable
class PlanItem {
  const PlanItem(this.food, this.grams);

  final PricedFood food;

  /// 먹는 부분 g.
  final double grams;

  Nutrients get nutrients => food.per100 * (grams / 100);
  double get won => grams * food.wonPerGram;
}

@immutable
class PlanMeal {
  const PlanMeal(this.type, this.items);

  final MealType type;
  final List<PlanItem> items;

  Nutrients get total => items.fold(Nutrients.zero, (a, i) => a + i.nutrients);
  double get won => items.fold(0.0, (a, i) => a + i.won);
}

@immutable
class PlanDay {
  const PlanDay(this.meals);

  final List<PlanMeal> meals;

  Nutrients get total => meals.fold(Nutrients.zero, (a, m) => a + m.total);
  double get won => meals.fold(0.0, (a, m) => a + m.won);
}

/// 장보기 한 줄. 먹는 양을 파는 단위로 올림.
@immutable
class ShopLine {
  const ShopLine({required this.food, required this.grams, required this.packs});

  final PricedFood food;
  final double grams;
  final int packs;

  int get won => packs * food.price.won;

  /// 다 먹고 남는 양(먹는 부분 g).
  double get leftover => packs * food.item.packGrams * food.item.edible - grams;
}

@immutable
class BudgetPlan {
  const BudgetPlan({required this.days, required this.shopping, required this.reasons, required this.target});

  final List<PlanDay> days;
  final List<ShopLine> shopping;
  final List<String> reasons;
  final Nutrients target;

  bool get isEmpty => days.isEmpty;

  /// 먹은 만큼만 친 하루 평균 값.
  double get dayWon => days.isEmpty ? 0 : days.fold(0.0, (a, d) => a + d.won) / days.length;

  /// 장보기 금액(파는 단위로 올림).
  int get shopWon => shopping.fold(0, (a, s) => a + s.won);

  Nutrients get dayAverage =>
      days.isEmpty ? Nutrients.zero : days.fold(Nutrients.zero, (a, d) => a + d.total) * (1 / days.length);
}

BudgetPlan planBudget({required Nutrients daily, required List<PricedFood> foods, int days = 7}) {
  BudgetPlan empty(String why) => BudgetPlan(days: const [], shopping: const [], reasons: [why], target: daily);

  final vegs = foods.where((f) => f.item.role == FoodRole.veg).toList()
    ..sort((a, b) => a.wonPerGram.compareTo(b.wonPerGram));
  final proteins = foods.where((f) => f.item.role == FoodRole.protein && f.item.mealItem).toList();
  final carbs = foods.where((f) => f.item.role == FoodRole.carb).toList();
  final fats = foods.where((f) => f.item.role == FoodRole.fat && f.per100.fat > 0).toList()
    ..sort((a, b) => (a.wonPerGram / a.per100.fat).compareTo(b.wonPerGram / b.per100.fat));
  if (proteins.isEmpty || carbs.isEmpty) return empty('단백질·탄수화물 식재료가 없어요');

  final vegPick = vegs.take(2).toList();
  final vegDay = vegPick.isEmpty ? Nutrients.zero : vegPick.first.per100 * (2 * vegPerMeal / 100);
  final mealTarget = (daily - vegDay).floorZero * (1 / 3);

  final combos = <_Combo>[];
  for (final p in proteins) {
    for (final c in carbs) {
      final s = solvePair(
        Candidate(name: p.item.id, per100: p.per100),
        Candidate(name: c.item.id, per100: c.per100),
        mealTarget,
        pMax: p.item.maxPerMeal,
        cMax: c.item.maxPerMeal,
      );
      if (s == null) continue;
      final items = [PlanItem(p, s.items[0].amount), PlanItem(c, s.items[1].amount)];
      final short = mealTarget.fat - items.fold(0.0, (a, i) => a + i.nutrients.fat);
      if (short > 2 && fats.isNotEmpty) {
        final f = fats.first;
        final g = ((short / (f.per100.fat / 100)).clamp(0, f.item.maxPerMeal) / 5).round() * 5.0;
        if (g > 0) items.add(PlanItem(f, g));
      }
      final total = items.fold(Nutrients.zero, (a, i) => a + i.nutrients);
      final ok = (total.kcal - mealTarget.kcal).abs() <= mealTarget.kcal * kcalTolerance &&
          total.protein >= mealTarget.protein * minProteinRatio;
      combos.add(_Combo(items, ok, s.score));
    }
  }
  if (combos.isEmpty) return empty('목표에 맞는 조합을 찾지 못했어요');

  final feasible = combos.where((c) => c.ok).toList()..sort((a, b) => a.won.compareTo(b.won));
  final reasons = <String>[
    '하루 ${daily.kcal.round()}kcal · 단백질 ${daily.protein.round()}g 에 맞춰 세 끼로 나눴어요',
    if (vegPick.isNotEmpty) '점심·저녁에 값이 싼 채소(${vegPick.map((v) => v.item.name).join('·')}) 100g씩',
  ];
  List<_Combo> source;
  if (feasible.isEmpty) {
    source = combos..sort((a, b) => a.score.compareTo(b.score));
    reasons.add('목표를 다 맞추는 조합이 없어 가장 가까운 조합을 썼어요');
  } else {
    source = feasible;
    reasons.add('열량 ±${(kcalTolerance * 100).round()}%, 단백질 ${(minProteinRatio * 100).round()}% 이상 맞는 '
        '${feasible.length}개 조합 중 싼 순서로, 끼니마다 겹치지 않게 골랐어요');
  }
  // 단백질이 겹치지 않는 것부터(가장 싼 조합의 2배까지), 모자라면 탄수화물이 다른 것으로 채운다(1.5배까지).
  final cheapest = feasible.isEmpty ? double.infinity : feasible.first.won;
  final pool = <_Combo>[];
  final usedProtein = <String>{};
  for (final c in source) {
    if (pool.length == poolSize) break;
    if (c.won > cheapest * varietyPriceRatio) break;
    if (usedProtein.add(c.items.first.food.item.groupId)) pool.add(c);
  }
  source = source.where((c) => c.won <= cheapest * maxPriceRatio).toList();
  for (final c in source) {
    if (pool.length == poolSize) break;
    if (!pool.contains(c) && !pool.any((p) => p.items[1].food.item.id == c.items[1].food.item.id)) pool.add(c);
  }

  const mains = [MealType.breakfast, MealType.lunch, MealType.dinner];
  final plan = [
    for (var d = 0; d < days; d++)
      PlanDay([
        for (var m = 0; m < mains.length; m++)
          PlanMeal(mains[m], [
            ...pool[(d + m) % pool.length].items,
            if (m > 0 && vegPick.isNotEmpty) PlanItem(vegPick[(d + m) % vegPick.length], vegPerMeal),
          ]),
      ]),
  ];

  final grams = <String, double>{};
  final byId = <String, PricedFood>{};
  for (final day in plan) {
    for (final meal in day.meals) {
      for (final i in meal.items) {
        grams[i.food.item.id] = (grams[i.food.item.id] ?? 0) + i.grams;
        byId[i.food.item.id] = i.food;
      }
    }
  }
  final shopping = [
    for (final e in grams.entries)
      ShopLine(
        food: byId[e.key]!,
        grams: e.value,
        packs: (e.value / (byId[e.key]!.item.packGrams * byId[e.key]!.item.edible) - 1e-9).ceil(),
      ),
  ]..sort((a, b) => b.won.compareTo(a.won));

  return BudgetPlan(days: plan, shopping: shopping, reasons: reasons, target: daily);
}

class _Combo {
  _Combo(this.items, this.ok, this.score);

  final List<PlanItem> items;
  final bool ok;
  final double score;

  double get won => items.fold(0.0, (a, i) => a + i.won);
}
