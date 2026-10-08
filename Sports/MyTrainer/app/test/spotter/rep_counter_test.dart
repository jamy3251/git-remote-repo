import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/spotter/rep_counter.dart';

import '../fixtures/squat_synth.dart';

void main() {
  test('무릎 각도 계산', () {
    expect(RepCounter.kneeAngle(frame(0, 170), 0.5), closeTo(170, 1e-6));
    expect(RepCounter.kneeAngle(frame(0, 90), 0.5), closeTo(90, 1e-6));
  });

  test('깨끗한 스쿼트 5회', () {
    expect(countReps(squats()), 5);
  });

  test('흔들림 ±6도, 여러 템포에서도 정확히 센다', () {
    for (final (seed, repMs) in [(1, 1500), (2, 2200), (3, 3000), (4, 1200)]) {
      expect(countReps(squats(reps: 8, repMs: repMs, noise: 6, seed: seed)), 8, reason: 'seed $seed, $repMs ms');
    }
  });

  test('앉은 자세로 촬영을 시작하면 첫 번째 일어서기는 세지 않는다', () {
    expect(countReps(squats(reps: 3, startAngle: 90, leadMs: 800)), 3);
  });

  test('깊이 미달(하프 스쿼트)은 세지 않는다', () {
    expect(countReps(squats(reps: 4, bottom: 130)), 0);
  });

  test('가려져서 확률이 낮은 프레임은 버리고, 앞뒤로 이어서 센다', () {
    final frames = squats(reps: 4);
    final occluded = [
      for (final f in frames)
        (f.tMs > 2500 && f.tMs < 3200) ? frame(f.tMs, 120, likelihood: 0.2) : f,
    ];
    final c = RepCounter();
    for (final f in occluded) {
      c.feed(f);
    }
    expect(c.reps, 4);
    expect(c.framesIgnored, greaterThan(15));
  });

  test('너무 빠른 오르내림(흔들림)은 세지 않는다', () {
    final frames = [
      for (var t = 0; t < 600; t += 33) frame(t, 175),
      // 300ms 만에 깊이를 찍고 돌아옴 → 무시
      for (var t = 600; t < 900; t += 33) frame(t, t < 750 ? 95 : 175),
      for (var t = 900; t < 1500; t += 33) frame(t, 175),
    ];
    expect(countReps(frames, const RepCounterConfig(smoothing: 1)), 0);
  });

  test('더 잘 보이는 쪽 다리를 쓴다', () {
    final f = PoseFrame(0, {
      Joint.leftHip: const Pt(0, -40, 0.3),
      Joint.leftKnee: const Pt(0, 0, 0.3),
      Joint.leftAnkle: const Pt(0, 40, 0.3),
      Joint.rightHip: const Pt(40, 0, 0.9),
      Joint.rightKnee: const Pt(0, 0, 0.9),
      Joint.rightAnkle: const Pt(0, 40, 0.9),
    });
    expect(RepCounter.kneeAngle(f, 0.5), closeTo(90, 1e-6));
    expect(RepCounter.kneeAngle(f, 0.95), isNull);
  });

  test('프레임 JSON 왕복(녹화 파일)', () {
    final f = frame(1234, 100);
    final back = PoseFrame.fromJson(f.toJson());
    expect(back.tMs, 1234);
    expect(RepCounter.kneeAngle(back, 0.5), closeTo(100, 0.2));
    final partial = PoseFrame(5, const {Joint.leftKnee: Pt(1, 2, 0.5)});
    expect(PoseFrame.fromJson(partial.toJson()).joints.keys, [Joint.leftKnee]);
  });
}
