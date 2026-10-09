import 'dart:math' as math;

import 'package:meta/meta.dart';

/// 스쿼트 반복 수 세기에 쓰는 관절. 측면 촬영이라 보이는 쪽 다리 하나만 쓴다.
enum Joint { leftHip, leftKnee, leftAnkle, rightHip, rightKnee, rightAnkle }

@immutable
class Pt {
  const Pt(this.x, this.y, this.likelihood);

  final double x, y;

  /// ML Kit 가 준 "이 관절이 보인다" 확률(0~1).
  final double likelihood;
}

/// 포즈 한 프레임. [tMs] 는 촬영 시작부터의 밀리초.
@immutable
class PoseFrame {
  const PoseFrame(this.tMs, this.joints);

  final int tMs;
  final Map<Joint, Pt> joints;

  List<Object> toJson() => [
        tMs,
        for (final j in Joint.values) ...[
          _r(joints[j]?.x),
          _r(joints[j]?.y),
          _r(joints[j]?.likelihood),
        ],
      ];

  static double _r(double? v) => v == null ? -1 : (v * 1000).round() / 1000;

  factory PoseFrame.fromJson(List<dynamic> a) {
    final joints = <Joint, Pt>{};
    for (final (i, j) in Joint.values.indexed) {
      final l = (a[3 + i * 3] as num).toDouble();
      if (l < 0) continue;
      joints[j] = Pt((a[1 + i * 3] as num).toDouble(), (a[2 + i * 3] as num).toDouble(), l);
    }
    return PoseFrame((a[0] as num).toInt(), joints);
  }
}

/// 실측으로 조정하는 값(tool/accuracy/rep_eval.dart). 각도는 무릎 각(엉덩이-무릎-발목), 서 있으면 약 180도.
@immutable
class RepCounterConfig {
  const RepCounterConfig({
    this.downAngle = 110,
    this.upAngle = 155,
    this.minLikelihood = 0.5,
    this.minRepMs = 600,
    this.smoothing = 0.5,
  });

  /// 이 각도 아래로 내려가야 한 번 앉은 것으로 본다.
  final double downAngle;

  /// 다시 이 각도 위로 올라오면 한 번.
  final double upAngle;

  /// 엉덩이·무릎·발목 중 가장 낮은 확률이 이보다 낮으면 그 프레임은 버린다(가려짐).
  final double minLikelihood;

  /// 이보다 빠른 반복은 흔들림으로 보고 세지 않는다.
  final int minRepMs;

  /// 지수 이동 평균 가중치(새 값 비중). 1이면 평활 없음.
  final double smoothing;

  RepCounterConfig copyWith({double? downAngle, double? upAngle}) => RepCounterConfig(
        downAngle: downAngle ?? this.downAngle,
        upAngle: upAngle ?? this.upAngle,
        minLikelihood: minLikelihood,
        minRepMs: minRepMs,
        smoothing: smoothing,
      );
}

enum RepPhase {
  /// 아직 서 있는 자세를 못 봤다. 앉은 채로 시작해도 세지 않으려고.
  waiting,
  standing,

  /// 서 있다가 내려가는 중(아직 깊이 미달).
  descending,

  /// 깊이 도달. 올라오면 한 번.
  bottom,
}

/// 무릎 각도로 도는 반복 카운터(설계 §4). 자세 판정은 하지 않는다.
///
///   waiting --(각도 ≥ up)--> standing --(< up)--> descending --(≤ down)--> bottom
///   bottom --(≥ up, 걸린 시간 ≥ minRepMs)--> standing (+1)
///   descending --(≥ up, 깊이 미달)--> standing (안 셈)
class RepCounter {
  RepCounter([this.config = const RepCounterConfig()]);

  final RepCounterConfig config;

  int reps = 0;
  RepPhase phase = RepPhase.waiting;
  double? angle;
  int framesUsed = 0;
  int framesIgnored = 0;
  int _repStartMs = 0;

  /// 프레임 하나를 넣는다. 이번 프레임에 한 번이 세어졌으면 true.
  bool feed(PoseFrame f) {
    final raw = kneeAngle(f, config.minLikelihood);
    if (raw == null) {
      framesIgnored++;
      return false;
    }
    framesUsed++;
    final a = angle == null ? raw : angle! + config.smoothing * (raw - angle!);
    angle = a;

    switch (phase) {
      case RepPhase.waiting:
        if (a >= config.upAngle) phase = RepPhase.standing;
      case RepPhase.standing:
        if (a < config.upAngle) {
          phase = RepPhase.descending;
          _repStartMs = f.tMs;
        }
      case RepPhase.descending:
        if (a <= config.downAngle) {
          phase = RepPhase.bottom;
        } else if (a >= config.upAngle) {
          phase = RepPhase.standing;
        }
      case RepPhase.bottom:
        if (a >= config.upAngle) {
          phase = RepPhase.standing;
          if (f.tMs - _repStartMs >= config.minRepMs) {
            reps++;
            return true;
          }
        }
    }
    return false;
  }

  /// 더 잘 보이는 쪽 다리의 무릎 각도(도). 둘 다 안 보이면 null.
  static double? kneeAngle(PoseFrame f, double minLikelihood) {
    double? side(Joint hip, Joint knee, Joint ankle) {
      final h = f.joints[hip], k = f.joints[knee], a = f.joints[ankle];
      if (h == null || k == null || a == null) return null;
      final l = math.min(h.likelihood, math.min(k.likelihood, a.likelihood));
      if (l < minLikelihood) return null;
      return l;
    }

    final left = side(Joint.leftHip, Joint.leftKnee, Joint.leftAnkle);
    final right = side(Joint.rightHip, Joint.rightKnee, Joint.rightAnkle);
    if (left == null && right == null) return null;
    final useLeft = right == null || (left != null && left >= right);
    final h = f.joints[useLeft ? Joint.leftHip : Joint.rightHip]!;
    final k = f.joints[useLeft ? Joint.leftKnee : Joint.rightKnee]!;
    final a = f.joints[useLeft ? Joint.leftAnkle : Joint.rightAnkle]!;
    return angleAt(k, h, a);
  }

  /// 꼭짓점 [v] 에서 [p]·[q] 로 가는 두 선분 사이 각도(도).
  static double angleAt(Pt v, Pt p, Pt q) {
    final ax = p.x - v.x, ay = p.y - v.y, bx = q.x - v.x, by = q.y - v.y;
    final na = math.sqrt(ax * ax + ay * ay), nb = math.sqrt(bx * bx + by * by);
    if (na == 0 || nb == 0) return 180;
    final c = ((ax * bx + ay * by) / (na * nb)).clamp(-1.0, 1.0);
    return math.acos(c) * 180 / math.pi;
  }
}

/// 녹화 하나의 반복 수를 센다(하네스·테스트용).
int countReps(Iterable<PoseFrame> frames, [RepCounterConfig config = const RepCounterConfig()]) {
  final c = RepCounter(config);
  for (final f in frames) {
    c.feed(f);
  }
  return c.reps;
}
