// 합성 스쿼트 관절 좌표. 실제 녹화(tool/accuracy/squat)가 모이기 전까지 카운터 규칙을 고정한다.
import 'dart:math' as math;

import 'package:mytrainer/spotter/rep_counter.dart';

/// 무릎 각도 → 측면 관절 좌표. 무릎 (0,0), 발목은 아래(0,40), 엉덩이는 발목 방향에서 [deg] 만큼 돌린 곳.
PoseFrame frame(int tMs, double deg, {double likelihood = 0.95, bool rightVisible = false}) {
  final r = deg * math.pi / 180;
  final hip = Pt(40 * math.sin(r), 40 * math.cos(r), likelihood);
  const knee = Pt(0, 0, 1), ankle = Pt(0, 40, 1);
  Pt k(Pt p) => Pt(p.x, p.y, math.min(p.likelihood, likelihood));
  return PoseFrame(tMs, {
    Joint.leftHip: hip,
    Joint.leftKnee: k(knee),
    Joint.leftAnkle: k(ankle),
    // 반대쪽 다리는 몸에 가려 잘 안 보인다.
    Joint.rightHip: Pt(hip.x, hip.y, rightVisible ? 0.99 : 0.1),
    Joint.rightKnee: Pt(0, 0, rightVisible ? 0.99 : 0.1),
    Joint.rightAnkle: Pt(0, 40, rightVisible ? 0.99 : 0.1),
  });
}

/// 30fps, 반복마다 [top]→[bottom]→[top] 코사인 곡선. [noise] 도 만큼 흔들림.
List<PoseFrame> squats({
  int reps = 5,
  int repMs = 2000,
  double top = 175,
  double bottom = 85,
  double noise = 0,
  int leadMs = 1000,
  double startAngle = 175,
  int seed = 1,
}) {
  final rnd = math.Random(seed);
  final frames = <PoseFrame>[];
  var t = 0;
  for (; t < leadMs; t += 33) {
    frames.add(frame(t, startAngle + (rnd.nextDouble() * 2 - 1) * noise));
  }
  final end = leadMs + reps * repMs;
  for (; t < end + 1000; t += 33) {
    final into = t - leadMs;
    final deg = into >= reps * repMs
        ? top
        : bottom + (top - bottom) * (1 + math.cos(2 * math.pi * (into % repMs) / repMs)) / 2;
    frames.add(frame(t, deg + (rnd.nextDouble() * 2 - 1) * noise));
  }
  return frames;
}
