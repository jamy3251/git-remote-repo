import 'package:flutter/foundation.dart';

import '../data/exercises.dart';
import '../data/models.dart';
import '../data/workout.dart';

/// 추정 1RM(Epley). 해낸 횟수만 쓰고, 10회 초과는 오차가 커서 계산하지 않는다.
///
/// 1회면 그 무게가 곧 1RM 이다. 무게가 0(맨몸)이면 의미가 없어 null.
double? estimateOneRm(double weightKg, int reps) {
  if (weightKg <= 0 || reps < 1 || reps > 10) return null;
  if (reps == 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/// 다음 세트 입력칸에 미리 채울 값.
@immutable
class Prefill {
  const Prefill({required this.weightKg, required this.reps, required this.source});

  final double weightKg;
  final int reps;
  final PrefillSource source;
}

enum PrefillSource {
  /// 오늘 같은 종목·기구의 직전 세트.
  previousSet,

  /// 지난 세션의 첫 세트(본 세트 시작 무게).
  lastSession,

  /// 기록이 없어서 기본값.
  none,
}

/// 기록을 읽어 다음 입력을 정하는 규칙들. 플러그인을 모르는 순수 계산이다.
class LoggingRules {
  const LoggingRules();

  /// [history] 는 순서 무관. 종목+기구가 같은 기록만 본다(스미스와 바벨은 섞지 않는다).
  Prefill prefill(List<WorkoutSet> history, String exerciseId, Variant variant, DateTime now) {
    final key = '$exerciseId|${variant.key}';
    final same = history.where((s) => s.key == key).toList()
      ..sort((a, b) => a.at.compareTo(b.at));

    final today = dayKey(now);
    final todays = same.where((s) => dayKey(s.at) == today).toList();
    if (todays.isNotEmpty) {
      final last = todays.last;
      // 무너진 세트 다음에는 같은 목표(무너진 회차)를 다시 잡는다.
      return Prefill(
        weightKg: last.weightKg,
        reps: last.failedAtRep ?? last.reps,
        source: PrefillSource.previousSet,
      );
    }

    final before = same.where((s) => dayKey(s.at).compareTo(today) < 0).toList();
    if (before.isNotEmpty) {
      final lastDay = dayKey(before.last.at);
      final first = before.firstWhere((s) => dayKey(s.at) == lastDay);
      return Prefill(
        weightKg: first.weightKg,
        reps: first.failedAtRep ?? first.reps,
        source: PrefillSource.lastSession,
      );
    }

    return Prefill(
      weightKg: variant == Variant.barbell ? 20 : 0,
      reps: 10,
      source: PrefillSource.none,
    );
  }

  /// 최근에 한 종목+기구, 최근 것부터 [limit] 개. 기록 화면의 기본 입력 경로다.
  List<({String exerciseId, Variant variant})> recent(List<WorkoutSet> history, {int limit = 8}) {
    final sorted = [...history]..sort((a, b) => b.at.compareTo(a.at));
    final seen = <String>{};
    final out = <({String exerciseId, Variant variant})>[];
    for (final s in sorted) {
      if (seen.add(s.key)) {
        out.add((exerciseId: s.exerciseId, variant: s.variant));
        if (out.length == limit) break;
      }
    }
    return out;
  }

  /// 종목을 고르면 마지막으로 쓴 기구가 기본값. 처음이면 카탈로그 첫 번째.
  Variant defaultVariant(List<WorkoutSet> history, Exercise exercise) {
    WorkoutSet? last;
    for (final s in history) {
      if (s.exerciseId == exercise.id && (last == null || s.at.isAfter(last.at))) last = s;
    }
    return last?.variant ?? exercise.variants.first;
  }

  /// 날짜별 최고 추정 1RM. 그래프용, 오래된 날부터.
  List<({String day, double oneRm})> oneRmTrend(List<WorkoutSet> history, String key) {
    final best = <String, double>{};
    for (final s in history) {
      if (s.key != key) continue;
      final e = estimateOneRm(s.weightKg, s.reps);
      if (e == null) continue;
      final d = dayKey(s.at);
      if (e > (best[d] ?? 0)) best[d] = e;
    }
    final days = best.keys.toList()..sort();
    return [for (final d in days) (day: d, oneRm: best[d]!)];
  }

  /// 그 날 앱에 기록한 세트 수. 세트 완결도(앱 기록 / 실제 세트) 분자.
  int setsOn(List<WorkoutSet> history, String day) =>
      history.where((s) => dayKey(s.at) == day).length;
}
