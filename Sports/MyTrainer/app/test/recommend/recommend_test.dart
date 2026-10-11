import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/workout.dart';
import 'package:mytrainer/diet/body_profile.dart';
import 'package:mytrainer/diet/food.dart';
import 'package:mytrainer/diet/meal.dart';
import 'package:mytrainer/diet/nutrients.dart';
import 'package:mytrainer/recommend/meal_planner.dart';
import 'package:mytrainer/recommend/workout_recommender.dart';

var _n = 0;
WorkoutSet s(DateTime at, String ex, double kg, int reps, {Variant v = Variant.barbell, int? failedAt}) => WorkoutSet(
    id: 's${_n++}', at: at, exerciseId: ex, variant: v, weightKg: kg, reps: reps, failedAtRep: failedAt);

MealEntry m(DateTime at, MealType meal, String name, double g, Nutrients n) =>
    MealEntry(id: 'm${_n++}', at: at, meal: meal, name: name, amount: g, nutrients: n, source: MealSource.manual);

void main() {
  final now = DateTime(2026, 10, 12, 18);
  DateTime ago(int days) => DateTime(2026, 10, 12 - days, 19);
  const rec = WorkoutRecommender();

  group('추천 운동: 부위', () {
    test('기록이 없으면 큰 부위 둘, 무게는 비움', () {
      final r = rec.recommend(const [], now);
      expect(r.groups, ['하체', '등']);
      expect(r.items.length, 5);
      expect(r.items.every((i) => i.weightKg == null), isTrue);
      expect(r.items.take(3).map((i) => i.exercise.id), ['squat', 'front_squat', 'leg_press']);
      expect(r.items.first.reason, contains('첫 세트 무게는 직접'));
    });

    test('어제 한 큰 부위는 회복 중이라 빼고, 이번 주 덜 한 부위가 먼저', () {
      final h = [
        for (var i = 0; i < 4; i++) s(ago(1), 'squat', 100, 5),
        for (var i = 0; i < 10; i++) s(ago(3), 'bench_press', 80, 8),
        for (var i = 0; i < 2; i++) s(ago(4), 'barbell_row', 60, 10),
        for (var i = 0; i < 8; i++) s(ago(2), 'overhead_press', 40, 8),
        for (var i = 0; i < 6; i++) s(ago(2), 'barbell_curl', 30, 10),
        for (var i = 0; i < 4; i++) s(ago(2), 'plank', 0, 1, v: Variant.bodyweight),
      ];
      final r = rec.recommend(h, now);
      expect(r.groups.contains('하체'), isFalse);
      expect(r.groups.first, '등'); // 2/10세트
      expect(r.reasons.first, '등: 이번 주 2/10세트, 4일 쉼');
      // 등은 최근 한 바벨 로우가 첫 종목.
      expect(r.items.first.exercise.id, 'barbell_row');
    });

    test('오늘 이미 한 부위는 다시 추천하지 않는다', () {
      final r = rec.recommend([s(now.subtract(const Duration(hours: 1)), 'deadlift', 120, 5)], now);
      expect(r.groups.contains('등'), isFalse);
    });
  });

  group('추천 운동: 다음 무게(이중 진행법)', () {
    final sq = exerciseById('squat')!;
    RecommendedItem squat(List<WorkoutSet> h, {Goal goal = Goal.maintain}) =>
        rec.prescribe(h, sq, Variant.barbell, goal: goal);

    test('모든 세트가 위쪽(12회)에 닿으면 바벨 하체 +5kg', () {
      final i = squat([for (var k = 0; k < 3; k++) s(ago(3), 'squat', 80, 12)]);
      expect((i.weightKg, i.sets, i.repsMin, i.repsMax), (85.0, 3, 8, 12));
      expect(i.reason, contains('5kg 올림'));
    });

    test('아직 못 닿았으면 같은 무게, 가장 적은 세트 +1회', () {
      final i = squat([s(ago(3), 'squat', 80, 12), s(ago(3), 'squat', 80, 10), s(ago(3), 'squat', 80, 9), s(ago(3), 'squat', 60, 15)]);
      expect((i.weightKg, i.sets, i.repsMin), (80.0, 3, 10));
    });

    test('같은 무게에서 두 세션 연속 실패면 10% 내림', () {
      final i = squat([
        s(ago(6), 'squat', 100, 6, failedAt: 7),
        s(ago(3), 'squat', 100, 5, failedAt: 6),
        s(ago(3), 'squat', 100, 8),
      ]);
      expect(i.weightKg, 90);
      expect(i.reason, contains('두 번 연속 실패'));
    });

    test('증량 폭은 기구마다: 바벨 상체 2.5, 덤벨 2, 머신 5', () {
      final bench = Exercise('bench_press', '벤치', const [Variant.barbell], group: '가슴');
      expect(increment(bench, Variant.barbell), 2.5);
      expect(increment(bench, Variant.dumbbell), 2);
      expect(increment(bench, Variant.machineGeneric), 5);
      expect(increment(exerciseById('deadlift')!, Variant.barbell), 5);
    });

    test('맨몸은 지난번 최고 +1회', () {
      final i = rec.prescribe([for (var k = 0; k < 3; k++) s(ago(3), 'pull_up', 0, 8 - k, v: Variant.bodyweight)],
          exerciseById('pull_up')!, Variant.bodyweight);
      expect((i.weightKg, i.repsMin), (null, 9));
    });

    test('증량 목표면 6~10회', () {
      final i = squat([for (var k = 0; k < 3; k++) s(ago(3), 'squat', 80, 10)], goal: Goal.bulk);
      expect((i.weightKg, i.repsMin, i.repsMax), (85.0, 6, 10));
    });

    test('추천 목록에 들어간 종목도 같은 규칙: 이번 주 덜 한 부위의 지난 기록으로 무게', () {
      final r = rec.recommend([
        for (var k = 0; k < 3; k++) s(ago(5), 'barbell_row', 60, 12),
        for (var k = 0; k < 10; k++) s(ago(2), 'squat', 100, 5),
        for (var k = 0; k < 10; k++) s(ago(2), 'bench_press', 80, 5),
      ], now);
      expect(r.groups.first, '등');
      final row = r.items.firstWhere((i) => i.exercise.id == 'barbell_row');
      expect(row.weightKg, 62.5);
    });

    test('루틴 줄로 바꾸면 근거가 메모로 남는다', () {
      final item = squat([for (var k = 0; k < 3; k++) s(ago(3), 'squat', 80, 12)]).toRoutineItem();
      expect((item.exerciseId, item.weightKg, item.note!.contains('올림')), ('squat', 85.0, true));
    });
  });

  group('추천 끼니', () {
    const chicken = Nutrients(kcal: 109, carb: 0, protein: 23, fat: 1.2);
    const rice = Nutrients(kcal: 143, carb: 31.5, protein: 2.7, fat: 0.3);
    final index = FoodIndex([
      const Food(code: 'a', name: '닭가슴살', per100: chicken).toTsv(),
      const Food(code: 'b', name: '현미밥', per100: Nutrients(kcal: 150, carb: 32, protein: 3, fat: 1)).toTsv(),
      const Food(code: 'c', name: '쌀밥', per100: rice).toTsv(),
      const Food(code: 'd', name: '두부', per100: Nutrients(kcal: 84, carb: 2, protein: 9, fat: 4.6)).toTsv(),
    ]);
    const target = Nutrients(kcal: 2400, carb: 300, protein: 150, fat: 67);

    test('남은 양을 남은 끼니로 나누고, 단백질·탄수화물을 맞춘 조합을 고른다', () {
      final today = [
        m(DateTime(2026, 10, 12, 8), MealType.breakfast, '아침', 0, const Nutrients(kcal: 600, carb: 80, protein: 30, fat: 15)),
        m(DateTime(2026, 10, 12, 12), MealType.lunch, '점심', 0, const Nutrients(kcal: 800, carb: 100, protein: 40, fat: 25)),
      ];
      final plan = planMeal(
          dailyTarget: target, today: today, candidates: buildCandidates(index: index, history: const []), now: now);
      expect((plan.meal, plan.mealsLeft), (MealType.dinner, 1));
      expect(plan.mealTarget, const Nutrients(kcal: 1000, carb: 120, protein: 80, fat: 27));
      expect(plan.suggestions, isNotEmpty);
      final best = plan.suggestions.first;
      expect(best.items.first.candidate.name, '닭가슴살');
      expect(best.total.protein, closeTo(80, 8));
      expect(best.total.carb, closeTo(120, 12));
      expect(best.items.every((i) => i.amount % 10 == 0 && i.amount >= 30 && i.amount <= 400), isTrue);
      // 같은 단백질 음식은 한 번만.
      expect(plan.suggestions.map((s) => s.items.first.candidate.name).toSet().length, plan.suggestions.length);
    });

    test('DB 없이도 두 번 이상 양과 함께 적은 음식으로 짠다', () {
      final history = [
        for (var d = 1; d <= 2; d++) ...[
          m(DateTime(2026, 10, 12 - d, 12), MealType.lunch, '닭가슴살', 200, chicken * 2),
          m(DateTime(2026, 10, 12 - d, 12), MealType.lunch, '쌀밥', 210, rice * 2.1),
        ],
        m(DateTime(2026, 10, 11, 12), MealType.lunch, '한 번 먹은 두부', 100, const Nutrients(kcal: 84, carb: 2, protein: 9, fat: 4.6)),
      ];
      final c = buildCandidates(history: history);
      expect(c.map((e) => (e.name, e.familiar)).toSet(), {('닭가슴살', true), ('쌀밥', true)});
      expect(c.first.per100.kcal, closeTo(109, 0.001));
      final plan = planMeal(dailyTarget: target, today: const [], candidates: c, now: DateTime(2026, 10, 12, 7));
      expect((plan.meal, plan.mealsLeft), (MealType.breakfast, 3));
      expect(plan.suggestions.single.items.map((i) => i.candidate.name), ['닭가슴살', '쌀밥']);
    });

    test('후보가 없거나 거의 다 먹었으면 제안하지 않고 이유를 말한다', () {
      final none = planMeal(dailyTarget: target, today: const [], candidates: const [], now: now);
      expect(none.suggestions, isEmpty);
      expect(none.note, contains('음식 DB'));
      final full = planMeal(
          dailyTarget: target,
          today: [m(now, MealType.dinner, '많이', 0, const Nutrients(kcal: 2300, carb: 300, protein: 150, fat: 60))],
          candidates: buildCandidates(index: index, history: const []),
          now: now);
      expect(full.note, contains('거의 채웠어요'));
    });
  });
}
