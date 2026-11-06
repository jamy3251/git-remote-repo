import 'package:meta/meta.dart';

import '../data/exercises.dart';
import '../data/models.dart';
import '../data/workout.dart';
import '../diet/body_profile.dart';
import '../routines/routine.dart';

/// 부위별 주간 목표 세트와 회복에 필요한 날 수.
const weeklySetTarget = <String, int>{'하체': 10, '등': 10, '가슴': 10, '어깨': 8, '팔': 6, '코어': 4};
const recoveryDays = <String, int>{'하체': 2, '등': 2, '가슴': 2, '어깨': 1, '팔': 1, '코어': 1};

/// 부위 2개 중 큰 쪽 3종목, 작은 쪽 2종목.
const _exercisesPerGroup = [3, 2];

@immutable
class RecommendedItem {
  const RecommendedItem({
    required this.exercise,
    required this.variant,
    required this.sets,
    required this.repsMin,
    required this.repsMax,
    required this.reason,
    this.weightKg,
  });

  final Exercise exercise;
  final Variant variant;
  final int sets;
  final int repsMin, repsMax;

  /// 기록이 없으면 null(첫 무게는 본인이 정한다).
  final double? weightKg;
  final String reason;

  RoutineItem toRoutineItem() => RoutineItem(
        exerciseId: exercise.id,
        variant: variant,
        sets: sets,
        repsMin: repsMin,
        repsMax: repsMax,
        weightKg: weightKg,
        note: reason,
      );
}

@immutable
class WorkoutRecommendation {
  const WorkoutRecommendation({required this.groups, required this.items, required this.reasons});

  final List<String> groups;
  final List<RecommendedItem> items;

  /// 부위를 고른 근거.
  final List<String> reasons;

  bool get isEmpty => items.isEmpty;

  String get title => '추천 · ${groups.join('·')}';
}

/// 목표에 따른 횟수 범위(이중 진행법의 위·아래).
(int, int) repRange(Goal? goal) => switch (goal) { Goal.bulk => (6, 10), _ => (8, 12) };

/// 기구별 증량 폭. 바벨 하체는 크게, 덤벨은 한 손 기준 2kg.
double increment(Exercise ex, Variant v) {
  if (v == Variant.bodyweight) return 0;
  if (v == Variant.barbell) return ex.group == '하체' || ex.id == 'deadlift' ? 5 : 2.5;
  if (v == Variant.smith) return 2.5;
  if (v == Variant.dumbbell) return 2;
  return 5; // 머신·케이블
}

double _round(double kg, double step) => step <= 0 ? kg : (kg / step).round() * step;

/// 오늘 운동 추천(설계 추가 범위). 기록만 보는 순수 계산이다.
class WorkoutRecommender {
  const WorkoutRecommender();

  WorkoutRecommendation recommend(List<WorkoutSet> history, DateTime now, {Goal? goal}) {
    final today = dayKey(now);
    final todayStart = DateTime(now.year, now.month, now.day);
    final weekAgo = todayStart.subtract(const Duration(days: 7));

    final groupOf = {for (final e in exerciseCatalog) e.id: e.group};
    final weekSets = <String, int>{};
    final lastDay = <String, DateTime>{};
    for (final s in history) {
      final g = groupOf[s.exerciseId];
      if (g == null || dayKey(s.at) == today) continue;
      if (!s.at.isBefore(weekAgo)) weekSets[g] = (weekSets[g] ?? 0) + 1;
      final d = DateTime(s.at.year, s.at.month, s.at.day);
      if (lastDay[g] == null || d.isAfter(lastDay[g]!)) lastDay[g] = d;
    }

    // 오늘 이미 한 부위는 빼고, 회복이 덜 된 부위도 뺀다.
    final doneToday = {for (final s in history) if (dayKey(s.at) == today) groupOf[s.exerciseId]};
    final scored = <(String, double, String)>[];
    for (final g in weeklySetTarget.keys) {
      if (doneToday.contains(g)) continue;
      final rest = lastDay[g] == null ? null : todayStart.difference(lastDay[g]!).inDays;
      if (rest != null && rest < recoveryDays[g]!) continue;
      final target = weeklySetTarget[g]!;
      final done = weekSets[g] ?? 0;
      final deficit = (target - done) / target;
      // 같은 부족분이면 오래 쉰 부위가 먼저. 큰 부위를 조금 앞세운다.
      final score = deficit + (rest == null ? 0.3 : (rest.clamp(0, 7) / 7) * 0.3) + (recoveryDays[g] == 2 ? 0.1 : 0);
      final why = rest == null
          ? '$g: 최근 기록 없음'
          : '$g: 이번 주 $done/$target세트, $rest일 쉼';
      scored.add((g, score, why));
    }
    scored.sort((a, b) => b.$2.compareTo(a.$2));
    // 큰 부위(하체·등·가슴) 하나를 먼저 고르고, 나머지에서 하나 더. 작은 부위끼리만 하는 날을 피한다.
    final big = scored.where((e) => recoveryDays[e.$1] == 2).firstOrNull ?? scored.firstOrNull;
    final groups = [
      if (big != null) big.$1,
      if (scored.where((e) => e != big).firstOrNull case final second?) second.$1,
    ];
    if (groups.isEmpty) {
      return const WorkoutRecommendation(groups: [], items: [], reasons: ['오늘은 모든 부위가 회복 중이에요. 쉬거나 가볍게 유산소를 하세요']);
    }
    // 큰 부위를 먼저(종목 3개).
    groups.sort((a, b) => recoveryDays[b]!.compareTo(recoveryDays[a]!));

    final items = <RecommendedItem>[];
    for (var i = 0; i < groups.length; i++) {
      for (final (ex, v) in _pickExercises(history, groups[i], _exercisesPerGroup[i], now)) {
        items.add(prescribe(history, ex, v, goal: goal));
      }
    }
    return WorkoutRecommendation(
      groups: groups,
      items: items,
      reasons: [for (final g in groups) scored.firstWhere((e) => e.$1 == g).$3],
    );
  }

  /// 최근 4주에 한 종목(많이 한 순) → 모자라면 카탈로그 순서.
  List<(Exercise, Variant)> _pickExercises(List<WorkoutSet> history, String group, int n, DateTime now) {
    final since = now.subtract(const Duration(days: 28));
    final counts = <String, int>{};
    final variantOf = <String, (Variant, DateTime)>{};
    for (final s in history) {
      final ex = exerciseById(s.exerciseId);
      if (ex == null || ex.group != group || s.at.isBefore(since)) continue;
      counts[s.exerciseId] = (counts[s.exerciseId] ?? 0) + 1;
      final prev = variantOf[s.exerciseId];
      if (prev == null || s.at.isAfter(prev.$2)) variantOf[s.exerciseId] = (s.variant, s.at);
    }
    final ids = counts.keys.toList()..sort((a, b) => counts[b]!.compareTo(counts[a]!));
    final out = <(Exercise, Variant)>[
      for (final id in ids.take(n)) (exerciseById(id)!, variantOf[id]!.$1),
    ];
    for (final ex in exerciseCatalog) {
      if (out.length >= n) break;
      if (ex.group != group || out.any((e) => e.$1.id == ex.id)) continue;
      out.add((ex, ex.variants.first));
    }
    return out;
  }

  /// 이중 진행법. 지난 두 세션(같은 종목·기구)을 본다.
  RecommendedItem prescribe(List<WorkoutSet> history, Exercise ex, Variant v, {Goal? goal}) {
    final (lo, hi) = repRange(goal);
    final key = '${ex.id}|${v.key}';
    final byDay = <String, List<WorkoutSet>>{};
    for (final s in history) {
      if (s.key == key) (byDay[dayKey(s.at)] ??= []).add(s);
    }
    final days = byDay.keys.toList()..sort();
    if (days.isEmpty) {
      return RecommendedItem(
        exercise: ex,
        variant: v,
        sets: 3,
        repsMin: lo,
        repsMax: hi,
        reason: v == Variant.bodyweight ? '처음 하는 종목: $lo회부터' : '기록이 없어요. 첫 세트 무게는 직접 정해 주세요',
      );
    }

    final last = byDay[days.last]!;
    final work = last.map((s) => s.weightKg).reduce((a, b) => a > b ? a : b);
    final atWork = last.where((s) => s.weightKg == work).toList();
    final sets = atWork.length.clamp(2, 5);
    final step = increment(ex, v);
    final failedLast = atWork.any((s) => s.failed);
    final prev = days.length >= 2 ? byDay[days[days.length - 2]]! : const <WorkoutSet>[];
    final failedPrevSameWeight = prev.any((s) => s.weightKg == work && s.failed);

    if (v == Variant.bodyweight || work <= 0) {
      final best = last.map((s) => s.reps).reduce((a, b) => a > b ? a : b);
      return RecommendedItem(
        exercise: ex,
        variant: v,
        sets: sets,
        repsMin: best + 1,
        repsMax: best + 1,
        reason: '지난번 최고 $best회 → 1회 더',
      );
    }

    final kg = _fmt(work);
    if (failedLast && failedPrevSameWeight) {
      final down = _round(work * 0.9, step == 0 ? 2.5 : step / 2);
      return RecommendedItem(
        exercise: ex,
        variant: v,
        sets: sets,
        repsMin: lo,
        repsMax: hi,
        weightKg: down,
        reason: '${kg}kg 에서 두 번 연속 실패 → 10% 내려 ${_fmt(down)}kg',
      );
    }
    final allTop = !failedLast && atWork.every((s) => s.reps >= hi);
    if (allTop) {
      return RecommendedItem(
        exercise: ex,
        variant: v,
        sets: sets,
        repsMin: lo,
        repsMax: hi,
        weightKg: work + step,
        reason: '${kg}kg 로 ${atWork.length}세트 모두 $hi회 이상 → ${_fmt(step)}kg 올림',
      );
    }
    final minReps = atWork.map((s) => s.reps).reduce((a, b) => a < b ? a : b);
    final target = (minReps + 1).clamp(lo, hi);
    return RecommendedItem(
      exercise: ex,
      variant: v,
      sets: sets,
      repsMin: target,
      repsMax: hi,
      weightKg: work,
      reason: failedLast ? '${kg}kg 에서 실패 있었음 → 같은 무게 유지' : '${kg}kg 유지, 가장 적게 한 세트 $minReps회 → $target회 목표',
    );
  }
}

String _fmt(double kg) => kg == kg.roundToDouble() ? kg.toInt().toString() : kg.toStringAsFixed(1);
