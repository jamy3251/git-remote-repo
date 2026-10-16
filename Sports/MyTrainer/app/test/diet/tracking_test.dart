import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/workout.dart';
import 'package:mytrainer/diet/meal.dart';
import 'package:mytrainer/diet/nutrients.dart';
import 'package:mytrainer/diet/tracking.dart';

MealEntry _meal(DateTime at, double kcal) => MealEntry(
      id: '${at.millisecondsSinceEpoch}-$kcal',
      at: at,
      meal: MealType.at(at),
      name: '밥',
      amount: 100,
      nutrients: Nutrients(kcal: kcal, carb: 0, protein: 0, fat: 0),
      source: MealSource.manual,
    );

WorkoutSet _set(DateTime at) =>
    WorkoutSet(id: '$at', at: at, exerciseId: 'squat', variant: Variant.barbell, weightKg: 60, reps: 8);

void main() {
  group('dailyIntake', () {
    test('하루 합계, 빈 날도 한 칸, 범위 밖은 뺀다', () {
      final days = dailyIntake([
        _meal(DateTime(2026, 10, 1, 8), 400),
        _meal(DateTime(2026, 10, 1, 19), 600),
        _meal(DateTime(2026, 10, 3, 12), 700),
        _meal(DateTime(2026, 9, 30, 12), 999),
      ], DateTime(2026, 10, 1), DateTime(2026, 10, 3, 23));
      expect(days.map((d) => d.eaten.kcal), [1000, 0, 700]);
      expect(days.map((d) => d.logged), [true, false, true]);
    });
  });

  group('workoutBurn', () {
    test('세트 시각으로 운동 시간, (MET-1)x체중x시간', () {
      final t = DateTime(2026, 10, 1, 19);
      // 0~58분 사이 세트 → 58분 + 마지막 세트 2분 = 60분
      final sets = [for (var m = 0; m <= 58; m += 2) _set(t.add(Duration(minutes: m)))];
      final b = workoutBurn(sets, 80)[DateTime(2026, 10, 1)]!;
      expect(b.minutes, 60);
      expect(b.kcal, closeTo(4 * 80 * 1.0, 0.01));
    });

    test('40분 넘게 벌어지면 두 번 운동으로 친다(사이 시간은 안 셈)', () {
      final t = DateTime(2026, 10, 1, 7);
      final b = workoutBurn([
        _set(t),
        _set(t.add(const Duration(minutes: 10))),
        _set(t.add(const Duration(hours: 10))),
      ], 70)[DateTime(2026, 10, 1)]!;
      expect(b.minutes, 10 + 2 + 2);
      expect(b.sets, 3);
    });
  });

  group('weightTrend', () {
    test('첫 값에서 시작해 하루 10%씩 따라가고 빈 날은 직선으로 채운다', () {
      final tr = weightTrend([
        WeightEntry(day: DateTime(2026, 10, 1), kg: 80),
        WeightEntry(day: DateTime(2026, 10, 3), kg: 78),
      ]);
      expect(tr.length, 3);
      expect(tr[0].trend, 80);
      expect(tr[1].measured, isNull);
      expect(tr[1].trend, closeTo(80 + 0.1 * (79 - 80), 1e-9));
      expect(tr[2].trend, closeTo(tr[1].trend + 0.1 * (78 - tr[1].trend), 1e-9));
    });
  });

  group('measureTdee', () {
    final now = DateTime(2026, 10, 29, 9);

    List<WeightEntry> losing({double from = 80, double perDay = 0.05, int every = 2}) => [
          for (var d = 0; d < 28; d += every)
            WeightEntry(day: DateTime(2026, 10, 1 + d), kg: from - perDay * d),
        ];

    List<MealEntry> eating(double kcal, {int skipEvery = 0}) => [
          for (var d = 0; d < 28; d++)
            if (skipEvery == 0 || d % skipEvery != 0) _meal(DateTime(2026, 10, 1 + d, 12), kcal),
        ];

    test('하루 0.05kg 빠지며 2000kcal 먹었으면 유지 열량은 약 2000+385', () {
      final m = measureTdee(meals: eating(2000), weights: losing(), now: now, formulaTdee: 2400);
      expect(m.ready, isTrue);
      // EMA 는 실제 기울기를 조금 늦게 따라가므로 넉넉히 본다.
      expect(m.kcal, inInclusiveRange(2200, 2400));
      expect(m.kgPerWeek, lessThan(0));
    });

    test('체중을 3번만 쟀으면 아직', () {
      final m = measureTdee(meals: eating(2000), weights: losing(every: 10), now: now, formulaTdee: 2400);
      expect(m.ready, isFalse);
      expect(m.reasons.single, contains('1번 더'));
    });

    test('식단을 남긴 날이 80% 아래면 아직', () {
      final m = measureTdee(meals: eating(2000, skipEvery: 3), weights: losing(), now: now, formulaTdee: 2400);
      expect(m.ready, isFalse);
      expect(m.reasons.single, contains('식단을 남겨'));
    });

    test('계산식과 35% 넘게 다르면 쓰지 않는다(기록 누락 의심)', () {
      final m = measureTdee(meals: eating(900), weights: losing(perDay: 0), now: now, formulaTdee: 2400);
      expect(m.ready, isFalse);
      expect(m.kcal, closeTo(900, 1));
      expect(m.reasons.last, contains('쓰지 않아요'));
    });

    test('기간이 2주가 안 되면 아직', () {
      final m = measureTdee(
        meals: eating(2000),
        weights: [for (var d = 18; d < 28; d += 2) WeightEntry(day: DateTime(2026, 10, 1 + d), kg: 80)],
        now: now,
        formulaTdee: 2400,
      );
      expect(m.ready, isFalse);
      expect(m.reasons.single, contains('일 더'));
    });
  });
}
