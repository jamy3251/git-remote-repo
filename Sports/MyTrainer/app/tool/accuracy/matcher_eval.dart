// 기구 매칭 정확도 하네스 2단계(설계 T7, D15).
//
// embed_photos.py 가 만든 임베딩으로 앱과 같은 MachineMatcher 를 돌린다.
//   1. tune 사진으로 자동 선택 임계값을 정한다: 자동으로 고른 것의 정답률이 97% 이상인
//      가장 낮은 값(틀린 자동 선택은 기록을 오염시키므로 정답률을 먼저 본다).
//      등록 사진이 없는 기구 폴더(tune·holdout 에만 있는 기구)는 "미등록 기구"로 쓴다.
//      이런 사진은 자동 선택되면 틀린 것이다. 실제 헬스장엔 등록 안 한 기구가 있으니 꼭 넣는다.
//   2. register 사진끼리 다른 기구 사이 최대 유사도로 중복 경고 임계값을 제안한다.
//   3. holdout 사진으로만 성공을 판단한다: 1위 정답률 85% 이상.
//
// 실행: dart run tool/accuracy/matcher_eval.dart tool/accuracy/embeddings.json
import 'dart:convert';
import 'dart:io';

import 'package:mytrainer/machines/machine.dart';
import 'package:mytrainer/machines/matcher.dart';

const targetTop1 = 0.85;
const targetAutoPrecision = 0.97;

class Shot {
  Shot(this.split, this.machine, this.file, this.vector);
  final String split, machine, file;
  final List<double> vector;
}

class Scores {
  Scores(this.top1, this.top3, this.autoRate, this.autoPrecision, this.unknownAuto, this.unknownN);
  final double top1, top3, autoRate;
  final double? autoPrecision;

  /// 미등록 기구 사진이 자동 선택된 수.
  final int unknownAuto, unknownN;
}

Scores evaluate(MachineMatcher m, List<Machine> machines, List<MachinePhoto> photos, List<Shot> queries) {
  final known = machines.map((x) => x.id).toSet();
  var n = 0, top1 = 0, top3 = 0, auto = 0, autoRight = 0, unknownAuto = 0, unknownN = 0;
  for (final q in queries) {
    final r = m.match(q.vector, machines, photos);
    if (!known.contains(q.machine)) {
      unknownN++;
      if (r.auto != null) {
        auto++;
        unknownAuto++;
      }
      continue;
    }
    n++;
    final ids = r.ranked.map((s) => s.machine.id).toList();
    if (ids.isNotEmpty && ids.first == q.machine) top1++;
    if (ids.take(3).contains(q.machine)) top3++;
    if (r.auto != null) {
      auto++;
      if (r.auto!.id == q.machine) autoRight++;
    }
  }
  return Scores(top1 / n, top3 / n, auto / (n + unknownN), auto == 0 ? null : autoRight / auto,
      unknownAuto, unknownN);
}

String pct(double? v) => v == null ? '-' : '${(v * 100).toStringAsFixed(1)}%';

void main(List<String> args) {
  if (args.length != 1) {
    stderr.writeln('사용법: dart run tool/accuracy/matcher_eval.dart <embeddings.json>');
    exit(64);
  }
  final j = jsonDecode(File(args[0]).readAsStringSync()) as Map<String, dynamic>;
  final modelId = j['modelId'] as String;
  final shots = [
    for (final i in j['items'] as List)
      Shot(i['split'] as String, i['machine'] as String, i['file'] as String,
          [for (final x in i['vector'] as List) (x as num).toDouble()]),
  ];
  List<Shot> split(String s) => shots.where((x) => x.split == s).toList();
  final register = split('register'), tune = split('tune'), holdout = split('holdout');
  if (register.isEmpty || tune.isEmpty || holdout.isEmpty) {
    stderr.writeln('register·tune·holdout 사진이 모두 있어야 해요 '
        '(지금 ${register.length}·${tune.length}·${holdout.length}장)');
    exit(65);
  }

  final names = register.map((s) => s.machine).toSet().toList()..sort();
  final machines = [
    for (final n in names)
      Machine(
        id: n,
        name: n,
        kind: MachineKind.machine,
        exerciseIds: const ['leg_press'],
        groupId: n,
        createdBy: 'eval',
        createdAt: DateTime(2026),
      ),
  ];
  final photos = [
    for (final (i, s) in register.indexed)
      MachinePhoto(
        id: '$i',
        machineId: s.machine,
        modelId: modelId,
        vector: s.vector,
        createdBy: 'eval',
        createdAt: DateTime(2026),
      ),
  ];
  final tuneQ = tune, holdQ = holdout;
  int unknownIn(List<Shot> q) => q.where((s) => !names.contains(s.machine)).length;
  if (unknownIn(tuneQ) == 0) {
    stderr.writeln('주의: tune 에 미등록 기구 사진이 없어요. 임계값이 너무 낮게 잡힐 수 있어요 '
        '(register 에 없는 기구 폴더를 tune·holdout 에 하나 이상 넣어 주세요).');
  }

  // 1. 자동 선택 임계값(tune).
  stdout.writeln('기구 ${machines.length}개, 등록 ${photos.length}장, '
      'tune ${tuneQ.length}장(미등록 ${unknownIn(tuneQ)}), holdout ${holdQ.length}장(미등록 ${unknownIn(holdQ)})');
  stdout.writeln('\n[tune] 임계값별 자동 선택');
  stdout.writeln('임계값  자동비율  자동정답률');
  double? chosen;
  for (var t = 0.50; t <= 0.9901; t += 0.02) {
    final s = evaluate(MachineMatcher(modelId: modelId, autoThreshold: t), machines, photos, tuneQ);
    stdout.writeln('${t.toStringAsFixed(2)}    ${pct(s.autoRate).padLeft(6)}   ${pct(s.autoPrecision).padLeft(6)}');
    if (chosen == null && s.autoPrecision != null && s.autoPrecision! >= targetAutoPrecision) chosen = t;
  }
  final auto = chosen ?? MachineMatcher.defaultAutoThreshold;
  stdout.writeln(chosen == null
      ? '→ 자동정답률 ${pct(targetAutoPrecision)}를 넘는 값이 없어 기본값 $auto 유지(자동 선택이 위험)'
      : '→ 자동 선택 임계값 ${auto.toStringAsFixed(2)}');

  // 2. 중복 경고 임계값(register 끼리).
  var crossMax = -1.0;
  var sameMin = 2.0;
  for (final a in photos) {
    for (final b in photos) {
      if (a.id == b.id) continue;
      final s = MachineMatcher.dot(MachineMatcher.normalize(a.vector), MachineMatcher.normalize(b.vector));
      if (a.machineId == b.machineId) {
        if (s < sameMin) sameMin = s;
      } else if (s > crossMax) {
        crossMax = s;
      }
    }
  }
  stdout.writeln('\n[register] 다른 기구 사이 최대 ${crossMax.toStringAsFixed(3)}, '
      '같은 기구 사진 사이 최소 ${sameMin == 2 ? '-' : sameMin.toStringAsFixed(3)}');
  stdout.writeln('→ 중복 경고 임계값은 다른 기구 최대보다 높게: ${(crossMax + 0.02).clamp(0, 1).toStringAsFixed(2)} 제안');

  // 3. holdout 판정.
  final tuneS = evaluate(MachineMatcher(modelId: modelId, autoThreshold: auto), machines, photos, tuneQ);
  final holdS = evaluate(MachineMatcher(modelId: modelId, autoThreshold: auto), machines, photos, holdQ);
  stdout.writeln('\n        1위     상위3   자동비율  자동정답률  미등록 오자동');
  for (final (name, s) in [('tune', tuneS), ('holdout', holdS)]) {
    stdout.writeln('${name.padRight(8)}${pct(s.top1).padLeft(6)}  ${pct(s.top3).padLeft(6)}  '
        '${pct(s.autoRate).padLeft(6)}   ${pct(s.autoPrecision).padLeft(6)}      ${s.unknownAuto}/${s.unknownN}');
  }
  final pass = holdS.top1 >= targetTop1;
  stdout.writeln('\nholdout 1위 정답률 ${pct(holdS.top1)} (목표 ${pct(targetTop1)}): ${pass ? '통과' : '미달'}');
  exit(pass ? 0 : 1);
}
