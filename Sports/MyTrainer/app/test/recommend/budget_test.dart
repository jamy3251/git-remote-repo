import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/diet/nutrients.dart';
import 'package:mytrainer/diet/price.dart';
import 'package:mytrainer/recommend/budget_planner.dart';

List<PricedFood> _foods({Map<String, int> overrides = const {}, PriceBook book = PriceBook.empty, PriceRegion? region}) =>
    pricedFoods(book: book, region: region, overrides: overrides);

const _cut = Nutrients(kcal: 2000, carb: 210, protein: 150, fat: 55);

void main() {
  test('일주일 식단: 매일 목표 근처, 끼니마다 단백질이 달라지고 장보기는 파는 단위로 올림', () {
    final plan = planBudget(daily: _cut, foods: _foods());
    expect(plan.days.length, 7);
    for (final d in plan.days) {
      expect(d.total.kcal, closeTo(_cut.kcal, _cut.kcal * 0.15));
      expect(d.total.protein, greaterThan(_cut.protein * 0.8));
      expect(d.meals.map((m) => m.items.map((i) => i.food.item.id).join()).toSet().length, 3);
    }
    for (final s in plan.shopping) {
      final pack = s.food.item.packGrams * s.food.item.edible;
      expect(s.packs * pack, greaterThanOrEqualTo(s.grams - 1e-6));
      expect((s.packs - 1) * pack, lessThan(s.grams));
    }
    expect(plan.shopWon, greaterThanOrEqualTo(plan.dayWon * 7 - 1));
    // ignore: avoid_print
    print('하루 ${plan.dayWon.round()}원, 장보기 ${plan.shopWon}원: '
        '${plan.days.first.meals.map((m) => m.items.map((i) => '${i.food.item.name} ${i.grams.round()}g').join('+')).join(' / ')}');
  });

  test('싼 단백질을 고른다: 닭가슴살을 아주 비싸게 고치면 빠진다', () {
    final pricey = planBudget(daily: _cut, foods: _foods(overrides: {'chicken_breast': 99000}));
    final ids = {for (final d in pricey.days) for (final m in d.meals) m.items.first.food.item.id};
    expect(ids, isNot(contains('chicken_breast')));
  });

  test('값 우선순위: 고친 값 > 지역 > 전국 > 참고값, 가까운 지역을 고른다', () {
    final book = PriceBook.parse('''{
      "regions": [
        {"name": "서울", "lat": 37.57, "lng": 126.98, "prices": {"egg": {"won": 7500, "source": "kamis", "date": "2026-10-10"}}},
        {"name": "부산", "lat": 35.18, "lng": 129.08, "prices": {"egg": {"won": 6900, "source": "kamis", "date": "2026-10-10"}}}
      ],
      "national": {"tofu": {"won": 1800, "source": "chamga", "date": "2026-10-03"}, "unknown": {"won": 1}}
    }''');
    final busan = book.nearest(35.1, 129.0)!;
    expect(busan.name, '부산');
    final egg = priceItemById('egg')!, tofu = priceItemById('tofu')!, rice = priceItemById('rice')!;
    expect(book.priceOf(egg, busan, const {}).won, 6900);
    expect(book.priceOf(egg, busan, const {'egg': 8000}).source, PriceSource.user);
    expect(book.priceOf(tofu, busan, const {}).source, PriceSource.chamga);
    expect(book.priceOf(rice, busan, const {}).source, PriceSource.base);
  });

  test('1g 값은 먹는 부분 기준(고등어는 60%만)', () {
    final m = _foods().firstWhere((f) => f.item.id == 'mackerel');
    expect(m.wonPerGram, closeTo(4000 / (350 * 0.6), 1e-9));
  });
}
