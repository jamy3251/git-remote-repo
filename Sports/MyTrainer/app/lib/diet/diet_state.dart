import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../recommend/coach.dart';
import '../recommend/meal_planner.dart';
import '../recommend/workout_recommender.dart';
import '../state/attendance.dart';
import '../state/workout.dart';
import 'body_profile.dart';
import 'diet_repository.dart';
import 'food.dart';
import 'food_db.dart';
import 'food_photo.dart';
import 'meal.dart';
import 'meal_draft.dart';
import 'nutrients.dart';

// main 에서 실제 값으로 덮어쓴다.
final dietRepositoryProvider =
    Provider<DietRepository>((ref) => LocalDietRepository(ref.watch(sharedPreferencesProvider)));
final foodPhotoAnalyzerProvider = Provider<FoodPhotoAnalyzer>((_) => UnavailableFoodPhotoAnalyzer());
final coachProvider = Provider<Coach>((_) => NoCoach());
final mealPhotoSourceProvider = Provider<MealPhotoSource>((_) => const PickerMealPhotoSource());

/// 규칙 결과(JSON 문자열) → AI 설명. 없으면 null 이고 화면은 규칙 근거만 보여준다.
final coachTextProvider = FutureProvider.family<String?, String>(
    (ref, factsJson) => ref.read(coachProvider).explain((jsonDecode(factsJson) as Map).cast()));

/// 시각. 테스트에서 고정한다.
final clockProvider = Provider<DateTime Function()>((_) => DateTime.now);

final bodyProfileProvider = AsyncNotifierProvider<BodyProfileController, BodyProfile?>(BodyProfileController.new);

class BodyProfileController extends AsyncNotifier<BodyProfile?> {
  @override
  Future<BodyProfile?> build() => ref.read(dietRepositoryProvider).profile();

  Future<void> save(BodyProfile p) async {
    await ref.read(dietRepositoryProvider).saveProfile(p);
    state = AsyncData(p);
  }
}

final dailyTargetProvider = Provider<DailyTarget?>((ref) {
  final p = ref.watch(bodyProfileProvider).valueOrNull;
  return p == null ? null : computeTarget(p, ref.read(clockProvider)());
});

/// 최근 30일 식단(추천 끼니의 "자주 먹는 음식"도 여기서 찾는다).
final mealsProvider = AsyncNotifierProvider<MealsController, List<MealEntry>>(MealsController.new);

class MealsController extends AsyncNotifier<List<MealEntry>> {
  DietRepository get _repo => ref.read(dietRepositoryProvider);

  @override
  Future<List<MealEntry>> build() async {
    final now = ref.read(clockProvider)();
    final since = DateTime(now.year, now.month, now.day).subtract(const Duration(days: 30));
    return (await _repo.meals(since: since))..sort((a, b) => a.at.compareTo(b.at));
  }

  Future<void> add(List<MealEntry> entries) async {
    for (final e in entries) {
      await _repo.saveMeal(e);
    }
    state = AsyncData([...state.valueOrNull ?? const <MealEntry>[], ...entries]..sort((a, b) => a.at.compareTo(b.at)));
  }

  Future<void> remove(String id) async {
    await _repo.deleteMeal(id);
    state = AsyncData([...?state.valueOrNull?.where((m) => m.id != id)]);
  }
}

final todayMealsProvider = Provider<List<MealEntry>>((ref) {
  final today = dayKey(ref.read(clockProvider)());
  return [...?ref.watch(mealsProvider).valueOrNull?.where((m) => dayKey(m.at) == today)];
});

final todayEatenProvider = Provider<Nutrients>(
    (ref) => ref.watch(todayMealsProvider).fold(Nutrients.zero, (a, m) => a + m.nutrients));

/// 음식 DB 가 아직 없거나 못 읽어도 추천 끼니는 내 기록만으로 계속 간다.
final _indexOrNullProvider = FutureProvider<FoodIndex?>((ref) async {
  try {
    final i = await ref.watch(foodIndexProvider.future);
    return i.length == 0 ? null : i;
  } catch (_) {
    return null;
  }
});

final mealPlanProvider = FutureProvider<MealPlan?>((ref) async {
  final target = ref.watch(dailyTargetProvider);
  if (target == null) return null;
  final meals = await ref.watch(mealsProvider.future);
  final index = await ref.watch(_indexOrNullProvider.future);
  final today = ref.watch(todayMealsProvider);
  return planMeal(
    dailyTarget: target.target,
    today: today,
    candidates: buildCandidates(index: index, history: meals),
    now: ref.read(clockProvider)(),
  );
});

final workoutRecommenderProvider = Provider((_) => const WorkoutRecommender());

final workoutRecommendationProvider = Provider<WorkoutRecommendation?>((ref) {
  final w = ref.watch(workoutProvider).valueOrNull;
  if (w == null) return null;
  final goal = ref.watch(bodyProfileProvider).valueOrNull?.goal;
  return ref.read(workoutRecommenderProvider).recommend(w.history, ref.read(clockProvider)(), goal: goal);
});
