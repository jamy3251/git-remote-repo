import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/workout.dart';
import 'package:mytrainer/services/logging_rules.dart';

var _n = 0;
WorkoutSet set(String ex, Variant v, double w, int reps,
        {required DateTime at, int? failedAt}) =>
    WorkoutSet(
      id: 's${_n++}',
      at: at,
      exerciseId: ex,
      variant: v,
      weightKg: w,
      reps: reps,
      failedAtRep: failedAt,
    );

DateTime d(int day, [int h = 18, int m = 0]) => DateTime(2026, 10, day, h, m);

void main() {
  const rules = LoggingRules();

  group('estimateOneRm', () {
    final cases = <(double, int, double?)>[
      (100, 1, 100), // 1회면 그 무게
      (100, 5, 100 * (1 + 5 / 30)),
      (100, 10, 100 * (1 + 10 / 30)),
      (100, 11, null), // 10회 초과는 계산 안 함
      (100, 0, null), // 0회(첫 회에 실패)
      (0, 8, null), // 맨몸
    ];
    for (final (w, r, want) in cases) {
      test('$w kg x $r', () {
        final got = estimateOneRm(w, r);
        if (want == null) {
          expect(got, isNull);
        } else {
          expect(got, closeTo(want, 1e-9));
        }
      });
    }
  });

  group('prefill', () {
    test('오늘 직전 세트를 그대로 채운다', () {
      final h = [
        set('squat', Variant.barbell, 80, 8, at: d(9, 18)),
        set('squat', Variant.barbell, 85, 6, at: d(9, 18, 5)),
      ];
      final p = rules.prefill(h, 'squat', Variant.barbell, d(9, 18, 8));
      expect((p.weightKg, p.reps, p.source), (85.0, 6, PrefillSource.previousSet));
    });

    test('직전 세트가 실패면 무너진 회차를 다시 목표로', () {
      final h = [set('squat', Variant.barbell, 100, 4, at: d(9), failedAt: 5)];
      final p = rules.prefill(h, 'squat', Variant.barbell, d(9, 19));
      expect(p.reps, 5);
    });

    test('오늘 기록이 없으면 지난 세션의 첫 세트', () {
      final h = [
        set('squat', Variant.barbell, 60, 10, at: d(5, 18)),
        set('squat', Variant.barbell, 80, 8, at: d(7, 18)),
        set('squat', Variant.barbell, 90, 5, at: d(7, 18, 10)),
      ];
      final p = rules.prefill(h, 'squat', Variant.barbell, d(9));
      expect((p.weightKg, p.reps, p.source), (80.0, 8, PrefillSource.lastSession));
    });

    test('스미스 기록은 바벨 미리 채우기에 섞이지 않는다', () {
      final h = [set('squat', Variant.smith, 60, 10, at: d(8))];
      final p = rules.prefill(h, 'squat', Variant.barbell, d(9));
      expect(p.source, PrefillSource.none);
      expect(p.weightKg, 20); // 빈 바
    });

    test('기록이 없으면 기본값(바벨 아닌 기구는 0kg)', () {
      final p = rules.prefill(const [], 'lat_pulldown', Variant.cable, d(9));
      expect((p.weightKg, p.reps, p.source), (0.0, 10, PrefillSource.none));
    });
  });

  test('recent: 최근 것부터, 종목+기구 단위로 중복 제거', () {
    final h = [
      set('squat', Variant.barbell, 80, 8, at: d(7)),
      set('bench_press', Variant.barbell, 60, 8, at: d(8)),
      set('squat', Variant.smith, 60, 10, at: d(8, 19)),
      set('squat', Variant.barbell, 80, 8, at: d(9)),
    ];
    expect(rules.recent(h).map((r) => '${r.exerciseId}|${r.variant.key}'), [
      'squat|barbell',
      'squat|smith',
      'bench_press|barbell',
    ]);
    expect(rules.recent(h, limit: 1), hasLength(1));
  });

  test('defaultVariant: 마지막으로 쓴 기구, 없으면 카탈로그 첫 번째', () {
    final squat = exerciseById('squat')!;
    expect(rules.defaultVariant(const [], squat), Variant.barbell);
    final h = [
      set('squat', Variant.barbell, 80, 8, at: d(7)),
      set('squat', Variant.smith, 60, 10, at: d(8)),
    ];
    expect(rules.defaultVariant(h, squat), Variant.smith);
  });

  test('oneRmTrend: 날짜별 최고값, 변형별 분리, 10회 초과 제외', () {
    final h = [
      set('squat', Variant.barbell, 100, 5, at: d(7)),
      set('squat', Variant.barbell, 105, 3, at: d(7, 18, 10)),
      set('squat', Variant.barbell, 60, 15, at: d(8)), // 제외
      set('squat', Variant.smith, 200, 1, at: d(8)), // 다른 변형
      set('squat', Variant.barbell, 110, 1, at: d(9)),
    ];
    final t = rules.oneRmTrend(h, 'squat|barbell');
    expect(t.map((e) => e.day), ['2026-10-07', '2026-10-09']);
    expect(t.first.oneRm, closeTo(116.666, 0.01)); // 100x5 > 105x3
    expect(t.last.oneRm, 110);
  });

  test('setsOn: 그 날 기록한 세트 수', () {
    final h = [
      set('squat', Variant.barbell, 80, 8, at: d(9, 18)),
      set('bench_press', Variant.barbell, 60, 8, at: d(9, 19)),
      set('squat', Variant.barbell, 80, 8, at: d(8)),
    ];
    expect(rules.setsOn(h, '2026-10-09'), 2);
  });

  test('WorkoutSet json 왕복', () {
    final s = WorkoutSet(
      id: 'x',
      at: d(9),
      exerciseId: 'squat',
      variant: Variant.machine('g1'),
      weightKg: 42.5,
      reps: 7,
      failedAtRep: 8,
      insideFence: true,
      taps: 3,
      entryMs: 4200,
    );
    final r = WorkoutSet.fromJson(s.toJson());
    expect(r.toJson(), s.toJson());
    expect(r.variant.isMachine, isTrue);
  });
}
