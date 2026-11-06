import 'package:meta/meta.dart';

import '../data/workout.dart';
import 'meal.dart';
import 'nutrients.dart';

/// 열량 추적(설계 추가 범위 N5). 하루 합계, 운동 소모 추정, 체중 추세, 실측 유지 열량.
/// 전부 규칙 계산이고 화면에 근거 문장을 같이 보인다.

DateTime dayOf(DateTime t) => DateTime(t.year, t.month, t.day);

/// 하루치 섭취. 기록이 하나도 없는 날은 [logged] 가 false 이고 0 으로 채운다.
@immutable
class DayIntake {
  const DayIntake({required this.day, required this.eaten, required this.entries});

  final DateTime day;
  final Nutrients eaten;
  final int entries;

  bool get logged => entries > 0;
}

/// [from]~[to] (날짜, 양끝 포함) 하루 합계. 빈 날도 한 칸씩 둔다.
List<DayIntake> dailyIntake(List<MealEntry> meals, DateTime from, DateTime to) {
  final start = dayOf(from), end = dayOf(to);
  final sums = <DateTime, Nutrients>{};
  final counts = <DateTime, int>{};
  for (final m in meals) {
    final d = dayOf(m.at);
    if (d.isBefore(start) || d.isAfter(end)) continue;
    sums[d] = (sums[d] ?? Nutrients.zero) + m.nutrients;
    counts[d] = (counts[d] ?? 0) + 1;
  }
  return [
    for (var d = start; !d.isAfter(end); d = DateTime(d.year, d.month, d.day + 1))
      DayIntake(day: d, eaten: sums[d] ?? Nutrients.zero, entries: counts[d] ?? 0),
  ];
}

// ---------------------------------------------------------------------------
// 운동 소모

/// 웨이트 트레이닝 MET. 2024 성인 신체활동 컴펜디엄의 저항운동(스쿼트·데드리프트 등) 5.0.
/// 쉬는 동안 쓰는 1 MET 는 기초대사량에 이미 들어 있으니 빼고 센다.
const strengthMet = 5.0;

/// 세트 사이가 이보다 벌어지면 다른 운동으로 본다.
const sessionGap = Duration(minutes: 40);

/// 마지막 세트 자체에 드는 시간(세트 시각은 끝난 시각이라 첫 세트 앞 시간도 이만큼 친다).
const setTime = Duration(minutes: 2);

@immutable
class WorkoutBurn {
  const WorkoutBurn({required this.day, required this.minutes, required this.sets, required this.kcal});

  final DateTime day;
  final int minutes;
  final int sets;
  final double kcal;
}

/// 날짜별 운동 소모 추정. 세트 기록 시각으로 운동 시간을 잡고 (MET−1)×체중×시간.
Map<DateTime, WorkoutBurn> workoutBurn(List<WorkoutSet> sets, double bodyKg) {
  final byDay = <DateTime, List<DateTime>>{};
  for (final s in sets) {
    (byDay[dayOf(s.at)] ??= []).add(s.at);
  }
  return {
    for (final e in byDay.entries) e.key: _burnOfDay(e.key, e.value..sort(), bodyKg),
  };
}

WorkoutBurn _burnOfDay(DateTime day, List<DateTime> times, double bodyKg) {
  var total = Duration.zero;
  var start = times.first;
  for (var i = 1; i <= times.length; i++) {
    if (i == times.length || times[i].difference(times[i - 1]) > sessionGap) {
      total += times[i - 1].difference(start) + setTime;
      if (i < times.length) start = times[i];
    }
  }
  final hours = total.inSeconds / 3600;
  return WorkoutBurn(
    day: day,
    minutes: total.inMinutes,
    sets: times.length,
    kcal: (strengthMet - 1) * bodyKg * hours,
  );
}

// ---------------------------------------------------------------------------
// 체중

@immutable
class WeightEntry {
  const WeightEntry({required this.day, required this.kg});

  final DateTime day;
  final double kg;

  Map<String, dynamic> toJson() => {'day': day.millisecondsSinceEpoch, 'kg': kg};

  factory WeightEntry.fromJson(Map<String, dynamic> j) =>
      WeightEntry(day: dayOf(DateTime.fromMillisecondsSinceEpoch((j['day'] as num).toInt())), kg: (j['kg'] as num).toDouble());
}

@immutable
class TrendPoint {
  const TrendPoint({required this.day, required this.trend, this.measured});

  final DateTime day;
  final double trend;

  /// 그날 잰 값. 안 잰 날은 null.
  final double? measured;
}

/// 하루 몸무게는 물·음식으로 1~2kg 씩 흔들린다. 지수 이동평균(하루 10%씩 따라감)으로
/// 추세만 남긴다. 안 잰 날은 앞뒤 측정값을 직선으로 이어 채운다.
const trendAlpha = 0.1;

List<TrendPoint> weightTrend(List<WeightEntry> entries) {
  if (entries.isEmpty) return const [];
  final byDay = {for (final e in entries) dayOf(e.day): e.kg};
  final days = byDay.keys.toList()..sort();
  final out = <TrendPoint>[];
  double? trend;
  for (var i = 0; i < days.length; i++) {
    final d = days[i];
    final kg = byDay[d]!;
    if (i > 0) {
      // 앞 측정일과 이 측정일 사이 빈 날
      final prev = days[i - 1];
      final gap = d.difference(prev).inDays;
      for (var k = 1; k < gap; k++) {
        final v = byDay[prev]! + (kg - byDay[prev]!) * k / gap;
        trend = trend! + trendAlpha * (v - trend);
        out.add(TrendPoint(day: DateTime(prev.year, prev.month, prev.day + k), trend: trend));
      }
    }
    trend = trend == null ? kg : trend + trendAlpha * (kg - trend);
    out.add(TrendPoint(day: d, trend: trend, measured: kg));
  }
  return out;
}

/// 체지방 1kg ≈ 7,700kcal. 몸무게 변화가 전부 체지방은 아니지만 2주 이상 평균이면 쓸 만하다.
const kcalPerKg = 7700.0;

/// 실측 유지 열량 계산에 필요한 최소 조건.
const minSpanDays = 14;
const minLoggedRatio = 0.8;
const minWeighIns = 4;

/// 실측 유지 열량. 평균 섭취 − 추세 체중 변화×7,700/일수.
@immutable
class MeasuredTdee {
  const MeasuredTdee({
    required this.ready,
    required this.reasons,
    this.kcal,
    this.days = 0,
    this.avgIntake = 0,
    this.kgPerWeek = 0,
  });

  /// 조건을 다 채워 목표 계산에 쓸 수 있는지.
  final bool ready;
  final double? kcal;
  final int days;
  final double avgIntake;
  final double kgPerWeek;

  /// 계산 근거 또는 아직 못 쓰는 이유.
  final List<String> reasons;
}

/// 최근 [window]일(오늘 제외, 오늘은 아직 덜 먹었으니) 중 첫 체중 기록부터 어제까지로 계산.
///
/// - 그 구간이 [minSpanDays]일 이상, 식단을 남긴 날이 [minLoggedRatio] 이상, 체중 [minWeighIns]번 이상.
/// - 식단을 거른 날은 평균에서 뺀다(0kcal 로 치면 유지 열량이 크게 낮아진다).
/// - 계산식 유지 열량에서 ±35% 넘게 벗어나면 기록이 빠졌을 가능성이 커서 쓰지 않는다.
MeasuredTdee measureTdee({
  required List<MealEntry> meals,
  required List<WeightEntry> weights,
  required DateTime now,
  required double formulaTdee,
  int window = 28,
}) {
  final yesterday = dayOf(now).subtract(const Duration(days: 1));
  final windowStart = dayOf(now).subtract(Duration(days: window));
  final inWindow = [for (final w in weights) if (!w.day.isBefore(windowStart) && !w.day.isAfter(yesterday)) w];
  if (inWindow.length < minWeighIns) {
    return MeasuredTdee(ready: false, reasons: ['체중을 ${minWeighIns - inWindow.length}번 더 재면 계산을 시작해요']);
  }
  final trend = weightTrend(weights.where((w) => !w.day.isAfter(yesterday)).toList());
  final first = inWindow.map((w) => w.day).reduce((a, b) => a.isBefore(b) ? a : b);
  final points = [for (final p in trend) if (!p.day.isBefore(first)) p];
  final span = points.last.day.difference(points.first.day).inDays;
  if (span < minSpanDays) {
    return MeasuredTdee(ready: false, reasons: ['체중 기록이 ${minSpanDays - span}일 더 쌓이면 계산해요']);
  }

  final days = dailyIntake(meals, points.first.day, points.last.day);
  final logged = days.where((d) => d.logged).toList();
  final ratio = logged.length / days.length;
  if (ratio < minLoggedRatio) {
    return MeasuredTdee(
      ready: false,
      days: days.length,
      reasons: ['${days.length}일 중 ${logged.length}일만 식단을 남겨 계산이 부정확해요 (${(minLoggedRatio * 100).round()}% 이상 필요)'],
    );
  }

  final avg = logged.fold(0.0, (a, d) => a + d.eaten.kcal) / logged.length;
  final dKg = points.last.trend - points.first.trend;
  final perDay = dKg / span;
  final tdee = avg - perDay * kcalPerKg;
  final kgPerWeek = perDay * 7;
  final reasons = [
    '최근 ${days.length}일 평균 섭취 ${avg.round()}kcal (식단 남긴 ${logged.length}일 기준)',
    '추세 체중 ${points.first.trend.toStringAsFixed(1)} → ${points.last.trend.toStringAsFixed(1)}kg '
        '(주 ${kgPerWeek >= 0 ? '+' : ''}${kgPerWeek.toStringAsFixed(2)}kg)',
    '체중 1kg ≈ 7,700kcal 로 환산 → 실제 유지 열량 ${tdee.round()}kcal',
  ];
  final off = (tdee - formulaTdee).abs() / formulaTdee;
  if (off > 0.35) {
    return MeasuredTdee(
      ready: false,
      kcal: tdee,
      days: days.length,
      avgIntake: avg,
      kgPerWeek: kgPerWeek,
      reasons: [...reasons, '계산식 값 ${formulaTdee.round()}kcal 와 ${(off * 100).round()}% 차이 나서 쓰지 않아요. 빠뜨린 기록이 있는지 봐 주세요'],
    );
  }
  return MeasuredTdee(ready: true, kcal: tdee, days: days.length, avgIntake: avg, kgPerWeek: kgPerWeek, reasons: reasons);
}
