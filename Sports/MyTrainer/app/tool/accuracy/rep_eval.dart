// 스쿼트 반복 카운터 정확도 하네스(설계 T8, D15). 성공 기준: holdout 에서 ±1회 이내 90% 이상.
//
// 재료: 스포터 모드를 쓸 때마다 촬영자 폰에 남는 관절 좌표 녹화(영상 아님).
//   adb pull /sdcard/Android/data/com.mytrainer.mytrainer/files/spotter_recordings
// 녹화의 truth 는 결과 화면에서 사람이 고친 횟수다. 직접 세서 맞는지 한 번 더 보고 나눠 넣는다.
//   tool/accuracy/squat/tune/*.json     각도 임계값을 고를 때
//   tool/accuracy/squat/holdout/*.json  다른 날·다른 폰·다른 사람. 성공 판단은 여기만
//
// 실행: dart run tool/accuracy/rep_eval.dart tool/accuracy/squat
import 'dart:convert';
import 'dart:io';

import 'package:mytrainer/spotter/recording.dart';
import 'package:mytrainer/spotter/rep_counter.dart';

const target = 0.90;

List<PoseRecording> load(Directory dir) => [
      if (dir.existsSync())
        for (final f in dir.listSync().whereType<File>().where((f) => f.path.endsWith('.json')))
          PoseRecording.fromJson(jsonDecode(f.readAsStringSync()) as Map<String, dynamic>),
    ];

class Score {
  Score(this.within1, this.exact, this.meanAbs, this.n);
  final double within1, exact, meanAbs;
  final int n;
}

Score score(List<PoseRecording> rs, RepCounterConfig c) {
  var w = 0, e = 0, abs = 0;
  for (final r in rs) {
    final d = (countReps(r.frames, c) - r.truth).abs();
    if (d <= 1) w++;
    if (d == 0) e++;
    abs += d;
  }
  final n = rs.length;
  return Score(w / n, e / n, abs / n, n);
}

String pct(double v) => '${(v * 100).toStringAsFixed(1)}%';

void main(List<String> args) {
  if (args.length != 1) {
    stderr.writeln('사용법: dart run tool/accuracy/rep_eval.dart <squat 폴더>');
    exit(64);
  }
  final tune = load(Directory('${args[0]}/tune'));
  final holdout = load(Directory('${args[0]}/holdout'));
  if (tune.isEmpty || holdout.isEmpty) {
    stderr.writeln('tune·holdout 녹화가 모두 있어야 해요(지금 ${tune.length}·${holdout.length}개)');
    exit(65);
  }

  // tune 에서 (내려감, 올라옴) 각도 격자 탐색. ±1 비율 → 정확 비율 → 평균 오차 순으로 고른다.
  const base = RepCounterConfig();
  var best = base;
  var bestS = score(tune, base);
  for (var down = 80.0; down <= 140; down += 5) {
    for (var up = down + 20; up <= 170; up += 5) {
      final c = base.copyWith(downAngle: down, upAngle: up);
      final s = score(tune, c);
      final better = s.within1 > bestS.within1 ||
          (s.within1 == bestS.within1 &&
              (s.exact > bestS.exact || (s.exact == bestS.exact && s.meanAbs < bestS.meanAbs)));
      if (better) {
        best = c;
        bestS = s;
      }
    }
  }

  final now = score(holdout, base);
  final tuned = score(holdout, best);
  stdout.writeln('녹화 tune ${tune.length}개, holdout ${holdout.length}개');
  stdout.writeln('현재 값   내려감 ${base.downAngle} / 올라옴 ${base.upAngle}');
  stdout.writeln('tune 최적 내려감 ${best.downAngle} / 올라옴 ${best.upAngle} '
      '(tune ±1 ${pct(bestS.within1)}, 정확 ${pct(bestS.exact)})');
  stdout.writeln('\n           ±1회    정확    평균 오차');
  for (final (name, s) in [('현재 값', now), ('tune 최적', tuned)]) {
    stdout.writeln('${name.padRight(9)}${pct(s.within1).padLeft(7)}  ${pct(s.exact).padLeft(6)}  '
        '${s.meanAbs.toStringAsFixed(2)}회');
  }
  final pass = tuned.within1 >= target;
  stdout.writeln('\nholdout ±1회 ${pct(tuned.within1)} (목표 ${pct(target)}): ${pass ? '통과' : '미달'}');
  stdout.writeln('통과하면 lib/spotter/spotter_state.dart 의 repCounterConfigProvider 에 tune 최적 값을 넣는다.');
  exit(pass ? 0 : 1);
}
