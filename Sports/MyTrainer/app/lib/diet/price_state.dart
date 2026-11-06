import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../recommend/budget_planner.dart';
import '../state/attendance.dart';
import 'diet_state.dart';
import 'food.dart';
import 'food_db.dart';
import 'price.dart';

/// 받은 시세. 만드는 법은 tool/prices/build_prices.dart. 없으면 참고값만 쓴다.
const priceAsset = 'assets/prices/prices.json';

Future<PriceBook> loadPriceBook({AssetBundle? bundle}) async {
  try {
    return PriceBook.parse(await (bundle ?? rootBundle).loadString(priceAsset));
  } catch (_) {
    return PriceBook.empty;
  }
}

final priceBookProvider = FutureProvider<PriceBook>((_) => loadPriceBook());

/// 사용자가 동네 가게 값으로 고친 가격(품목 id → 원). 이 기기에만 둔다.
final priceOverridesProvider = NotifierProvider<PriceOverrides, Map<String, int>>(PriceOverrides.new);

class PriceOverrides extends Notifier<Map<String, int>> {
  static const _key = 'mytrainer.price_overrides';

  @override
  Map<String, int> build() {
    final raw = ref.read(sharedPreferencesProvider).getString(_key);
    return raw == null ? {} : (jsonDecode(raw) as Map).map((k, v) => MapEntry(k as String, (v as num).round()));
  }

  Future<void> set(String id, int? won) async {
    state = {...state}..removeWhere((k, _) => k == id);
    if (won != null) state = {...state, id: won};
    await ref.read(sharedPreferencesProvider).setString(_key, jsonEncode(state));
  }
}

/// 헬스장 위치에서 가장 가까운 시세 지역.
final priceRegionProvider = FutureProvider<PriceRegion?>((ref) async {
  final book = await ref.watch(priceBookProvider.future);
  final gym = ref.watch(attendanceProvider).valueOrNull?.gym;
  return book.nearest(gym?.lat, gym?.lng);
});

final pricedFoodsProvider = FutureProvider<List<PricedFood>>((ref) async {
  final book = await ref.watch(priceBookProvider.future);
  final region = await ref.watch(priceRegionProvider.future);
  FoodIndex? index;
  try {
    final i = await ref.watch(foodIndexProvider.future);
    index = i.length == 0 ? null : i;
  } catch (_) {}
  return pricedFoods(book: book, region: region, overrides: ref.watch(priceOverridesProvider), index: index);
});

final budgetPlanProvider = FutureProvider<BudgetPlan?>((ref) async {
  final target = ref.watch(dailyTargetProvider);
  if (target == null) return null;
  return planBudget(daily: target.target, foods: await ref.watch(pricedFoodsProvider.future));
});
