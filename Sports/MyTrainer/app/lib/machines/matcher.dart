import 'dart:math' as math;

import 'package:meta/meta.dart';

import 'machine.dart';

@immutable
class MachineScore {
  const MachineScore(this.machine, this.score);

  final Machine machine;

  /// 그 기구 사진들과의 코사인 유사도 중 최댓값.
  final double score;
}

@immutable
class MatchResult {
  const MatchResult({required this.ranked, required this.auto, required this.otherModel});

  /// 점수 높은 순. 비교할 사진이 하나도 없는 기구는 빠진다.
  final List<MachineScore> ranked;

  /// 1위가 임계값 이상이면 그 기구. 확인 한 번으로 고른다.
  final Machine? auto;

  /// 모델이 달라 비교하지 못한 사진 수(D16: "사진 다시 찍기 필요").
  final int otherModel;

  List<MachineScore> get top3 => ranked.take(3).toList();
}

/// 사진 한 장으로 기구 찾기(설계 §3).
///
/// 기구별 점수 = 그 기구 사진들과의 최대 유사도. 1위가 [autoThreshold] 이상이면
/// 자동 선택, 아니면 상위 3개를 보여준다. 임계값은 tool/accuracy/matcher_eval.dart 로
/// tune 사진에서 정하고 holdout 사진으로만 성공 여부를 본다(D15).
class MachineMatcher {
  const MachineMatcher({
    required this.modelId,
    this.autoThreshold = defaultAutoThreshold,
    this.duplicateThreshold = defaultDuplicateThreshold,
  });

  final String modelId;
  final double autoThreshold;
  final double duplicateThreshold;

  // 실측 전 시작값. 헬스장 tune 사진으로 다시 정한다.
  static const defaultAutoThreshold = 0.80;
  static const defaultDuplicateThreshold = 0.88;

  MatchResult match(List<double> query, List<Machine> machines, List<MachinePhoto> photos) {
    final q = normalize(query);
    final best = <String, double>{};
    var other = 0;
    for (final p in photos) {
      if (p.modelId != modelId || p.dim != q.length) {
        other++;
        continue;
      }
      final s = dot(q, normalize(p.vector));
      if (s > (best[p.machineId] ?? double.negativeInfinity)) best[p.machineId] = s;
    }
    final ranked = [
      for (final m in machines)
        if (best[m.id] case final s?) MachineScore(m, s),
    ]..sort((a, b) => b.score.compareTo(a.score));

    final top = ranked.firstOrNull;
    return MatchResult(
      ranked: ranked,
      auto: top != null && top.score >= autoThreshold ? top.machine : null,
      otherModel: other,
    );
  }

  /// 등록 중인 사진들이 이미 있는 기구와 같아 보이면 그 기구(기존 기구에 사진 추가를 먼저 제안).
  /// 사진 여러 장이면 가장 닮은 것으로 본다.
  MachineScore? duplicateOf(List<List<double>> queries, List<Machine> machines, List<MachinePhoto> photos) {
    MachineScore? best;
    for (final q in queries) {
      final top = match(q, machines, photos).ranked.firstOrNull;
      if (top != null && (best == null || top.score > best.score)) best = top;
    }
    return best != null && best.score >= duplicateThreshold ? best : null;
  }

  static List<double> normalize(List<double> v) {
    var n = 0.0;
    for (final x in v) {
      n += x * x;
    }
    n = math.sqrt(n);
    if (n == 0) return v;
    return [for (final x in v) x / n];
  }

  static double dot(List<double> a, List<double> b) {
    var s = 0.0;
    for (var i = 0; i < a.length; i++) {
      s += a[i] * b[i];
    }
    return s;
  }
}
