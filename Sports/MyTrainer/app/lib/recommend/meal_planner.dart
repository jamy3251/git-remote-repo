import 'package:meta/meta.dart';

import '../diet/food.dart';
import '../diet/meal.dart';
import '../diet/nutrients.dart';

/// 추천 끼니의 기본 식재료. DB 에서 이름이 정확히 같은 것을 찾는다(앞에 있는 이름이 먼저).
/// 숫자는 여기 적지 않는다. DB 에 없으면 그 식재료는 빠진다.
const stapleNames = <List<String>>[
  ['닭가슴살', '닭고기 가슴살', '닭가슴살 구이'],
  ['달걀', '삶은 달걀', '달걀 삶은것'],
  ['두부', '두부 부침'],
  ['연어', '연어구이'],
  ['소고기 우둔', '쇠고기 우둔', '소고기 홍두깨'],
  ['고등어구이', '고등어'],
  ['그릭요거트', '플레인요구르트'],
  ['우유'],
  ['현미밥'],
  ['쌀밥', '백미밥'],
  ['잡곡밥'],
  ['고구마', '찐고구마', '고구마 찐것'],
  ['감자', '찐감자'],
  ['오트밀'],
  ['바나나'],
  ['통밀빵', '식빵'],
];

/// 추천 후보 음식. 내 기록에서 온 것이면 [familiar].
@immutable
class Candidate {
  const Candidate({required this.name, required this.per100, this.unit = 'g', this.code, this.familiar = false});

  final String name;
  final Nutrients per100;
  final String unit;
  final String? code;
  final bool familiar;

  double get proteinShare => per100.kcal <= 0 ? 0 : 4 * per100.protein / per100.kcal;
  double get carbShare => per100.kcal <= 0 ? 0 : 4 * per100.carb / per100.kcal;

  factory Candidate.fromFood(Food f) => Candidate(name: f.name, per100: f.per100, unit: f.unit, code: f.code);
}

/// 기본 식재료(DB) + 최근 30일에 2번 이상 먹은 음식(양을 적은 것만).
List<Candidate> buildCandidates({FoodIndex? index, required List<MealEntry> history}) {
  final out = <String, Candidate>{};
  final counts = <String, int>{};
  final latest = <String, MealEntry>{};
  for (final m in history) {
    if (m.amount <= 0 || m.nutrients.kcal <= 0) continue;
    final k = normalizeFoodName(m.name);
    counts[k] = (counts[k] ?? 0) + 1;
    if (latest[k] == null || m.at.isAfter(latest[k]!.at)) latest[k] = m;
  }
  for (final e in latest.entries) {
    if ((counts[e.key] ?? 0) < 2) continue;
    final m = e.value;
    out[e.key] = Candidate(
      name: m.name,
      per100: m.nutrients * (100 / m.amount),
      unit: m.unit,
      code: m.foodCode,
      familiar: true,
    );
  }
  if (index != null) {
    for (final names in stapleNames) {
      for (final n in names) {
        final f = index.exact(n);
        if (f == null) continue;
        out.putIfAbsent(normalizeFoodName(f.name), () => Candidate.fromFood(f));
        break;
      }
    }
  }
  return out.values.toList();
}

@immutable
class SuggestedItem {
  const SuggestedItem(this.candidate, this.amount);

  final Candidate candidate;
  final double amount;

  Nutrients get nutrients => candidate.per100 * (amount / 100);
}

@immutable
class MealSuggestion {
  const MealSuggestion({required this.items, required this.target, required this.score});

  final List<SuggestedItem> items;
  final Nutrients target;

  /// 낮을수록 목표에 가깝다.
  final double score;

  Nutrients get total => items.fold(Nutrients.zero, (a, i) => a + i.nutrients);
}

@immutable
class MealPlan {
  const MealPlan({required this.meal, required this.mealsLeft, required this.mealTarget, required this.suggestions, required this.note});

  final MealType meal;
  final int mealsLeft;
  final Nutrients mealTarget;
  final List<MealSuggestion> suggestions;

  /// 제안이 없을 때의 이유, 있을 때는 근거.
  final String note;
}

/// 이번 끼니 목표 = 오늘 남은 양 ÷ 남은 끼니 수(아침·점심·저녁 중 아직 안 먹은 것, 지금 끼니 포함).
/// 간식 시간이면 남은 양 전체를 한 번에 보지 않고 남은 끼니 수로 나눈다.
MealPlan planMeal({
  required Nutrients dailyTarget,
  required List<MealEntry> today,
  required List<Candidate> candidates,
  required DateTime now,
}) {
  final eaten = today.fold(Nutrients.zero, (a, m) => a + m.nutrients);
  final remaining = (dailyTarget - eaten).floorZero;
  final current = MealType.at(now);
  final done = today.map((m) => m.meal).toSet();
  const mains = [MealType.breakfast, MealType.lunch, MealType.dinner];
  final startIdx = switch (current) {
    MealType.breakfast => 0,
    MealType.lunch => 1,
    MealType.dinner => 2,
    MealType.snack => now.hour < 11 ? 1 : (now.hour < 17 ? 2 : 3),
  };
  final left = mains.skip(startIdx).where((m) => !done.contains(m)).length;
  final mealsLeft = left == 0 ? 1 : left;
  final meal = current == MealType.snack && left > 0 ? mains.skip(startIdx).firstWhere((m) => !done.contains(m)) : current;
  final mealTarget = remaining * (1 / mealsLeft);

  MealPlan empty(String note) =>
      MealPlan(meal: meal, mealsLeft: mealsLeft, mealTarget: mealTarget, suggestions: const [], note: note);

  if (remaining.kcal < 150) return empty('오늘 목표 열량을 거의 채웠어요');
  final proteins = candidates.where((c) => c.proteinShare >= 0.35).toList();
  final carbs = candidates.where((c) => c.carbShare >= 0.6).toList();
  if (proteins.isEmpty || carbs.isEmpty) {
    return empty('끼니를 짜려면 음식 DB 를 넣거나, 단백질·탄수화물 음식을 양과 함께 두 번 이상 기록해 주세요');
  }

  final all = <MealSuggestion>[];
  for (final p in proteins) {
    for (final c in carbs) {
      if (identical(p, c)) continue;
      final s = solvePair(p, c, mealTarget);
      if (s != null) all.add(s);
    }
  }
  all.sort((a, b) => a.score.compareTo(b.score));

  // 같은 단백질 음식이 세 제안을 다 차지하지 않게 한다.
  final picked = <MealSuggestion>[];
  final usedProtein = <String>{};
  for (final s in all) {
    if (!usedProtein.add(s.items.first.candidate.name)) continue;
    picked.add(s);
    if (picked.length == 3) break;
  }
  return MealPlan(
    meal: meal,
    mealsLeft: mealsLeft,
    mealTarget: mealTarget,
    suggestions: picked,
    note: '오늘 남은 ${remaining.kcal.round()}kcal 를 남은 끼니 $mealsLeft번으로 나눴어요',
  );
}

const _minAmount = 30.0, _maxAmount = 400.0;

/// 단백질 음식 g1, 탄수화물 음식 g2 로 단백질·탄수화물 두 식을 푼다. 장보기 식단도 이걸 쓴다.
MealSuggestion? solvePair(Candidate p, Candidate c, Nutrients t, {double pMax = _maxAmount, double cMax = _maxAmount}) {
  final p1 = p.per100.protein / 100, p2 = c.per100.protein / 100;
  final c1 = p.per100.carb / 100, c2 = c.per100.carb / 100;
  final det = p1 * c2 - p2 * c1;
  if (det.abs() < 1e-6) return null;
  var g1 = (t.protein * c2 - p2 * t.carb) / det;
  var g2 = (p1 * t.carb - t.protein * c1) / det;
  double fit(double g, double max) => ((g.clamp(_minAmount, max)) / 10).round() * 10.0;
  g1 = fit(g1, pMax);
  g2 = fit(g2, cMax);

  final items = [SuggestedItem(p, g1), SuggestedItem(c, g2)];
  final total = items.fold(Nutrients.zero, (a, i) => a + i.nutrients);
  double rel(double got, double want, double floor) => (got - want).abs() / (want < floor ? floor : want);
  final familiar = items.where((i) => i.candidate.familiar).length;
  final score = 2 * rel(total.kcal, t.kcal, 100) +
      rel(total.protein, t.protein, 10) +
      rel(total.carb, t.carb, 10) +
      0.5 * rel(total.fat, t.fat, 5) -
      0.15 * familiar;
  return MealSuggestion(items: items, target: t, score: score);
}
