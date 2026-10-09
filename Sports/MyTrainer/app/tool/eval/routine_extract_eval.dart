// 영상 → 루틴 추출 평가(설계 T9, D10·D15). 앱과 같은 모델·프롬프트·스키마(lib/routines/extract_spec.dart)로
// Gemini Developer API 를 직접 부르고, 앱과 같은 종목 연결기로 정답과 비교한다.
//
// 정답 파일: tool/eval/routines/{tune,holdout}.json
//   [{"url": "https://youtu.be/...", "truth": [{"exerciseId": "squat", "sets": 5, "repsMin": 5, "repsMax": 5}, ...]}]
//   holdout 은 tune 과 다른 채널·다른 사람이 고른 영상(성공 판단은 holdout 만).
//
// 실행:
//   GEMINI_API_KEY=... dart run tool/eval/routine_extract_eval.dart
//   dart run tool/eval/routine_extract_eval.dart --offline   (저장해 둔 응답만으로 다시 채점: 연결기만 바꿨을 때)
// 응답은 tool/eval/cache/ 에 영상별로 저장한다(커밋하지 않음).
import 'dart:convert';
import 'dart:io';

import 'package:mytrainer/routines/exercise_linker.dart';
import 'package:mytrainer/routines/extract_spec.dart';

const _dir = 'tool/eval';

class Truth {
  Truth(this.exerciseId, this.sets, this.repsMin, this.repsMax);
  final String exerciseId;
  final int? sets, repsMin, repsMax;
}

class Case {
  Case(this.url, this.truth);
  final String url;
  final List<Truth> truth;
}

List<Case> loadSplit(String name) {
  final f = File('$_dir/routines/$name.json');
  if (!f.existsSync()) return const [];
  return [
    for (final c in jsonDecode(f.readAsStringSync()) as List)
      Case(c['url'] as String, [
        for (final t in c['truth'] as List)
          Truth(t['exerciseId'] as String, t['sets'] as int?, t['repsMin'] as int?, t['repsMax'] as int?),
      ]),
  ];
}

String _cacheName(String url) => base64Url.encode(utf8.encode(url)).replaceAll('=', '');

Future<String?> fetch(String url, {required bool offline, required String? key}) async {
  final cache = File('$_dir/cache/${_cacheName(url)}.json');
  if (cache.existsSync()) return cache.readAsStringSync();
  if (offline || key == null) return null;

  final client = HttpClient();
  try {
    final req = await client.postUrl(Uri.parse(
        'https://generativelanguage.googleapis.com/v1beta/models/$extractModel:generateContent?key=$key'));
    req.headers.contentType = ContentType.json;
    req.write(jsonEncode({
      'contents': [
        {
          'parts': [
            {'fileData': {'mimeType': 'video/mp4', 'fileUri': url}},
            {'text': extractPrompt},
          ],
        },
      ],
      'generationConfig': {
        'temperature': 0,
        'responseMimeType': 'application/json',
        'responseSchema': extractSchema,
      },
    }));
    final res = await req.close();
    final body = await res.transform(utf8.decoder).join();
    if (res.statusCode != 200) {
      stderr.writeln('  요청 실패 ${res.statusCode}: ${body.length > 300 ? body.substring(0, 300) : body}');
      return null;
    }
    final text = (((jsonDecode(body) as Map)['candidates'] as List).first as Map)['content']['parts'][0]['text'] as String;
    cache.parent.createSync(recursive: true);
    cache.writeAsStringSync(text);
    return text;
  } finally {
    client.close();
  }
}

class Tally {
  int videos = 0, failed = 0;
  int truthN = 0, predN = 0, hit = 0, setsRight = 0, repsRight = 0;

  double get recall => truthN == 0 ? 0 : hit / truthN;
  double get precision => predN == 0 ? 0 : hit / predN;
  double get f1 => recall + precision == 0 ? 0 : 2 * recall * precision / (recall + precision);
}

String pct(double v) => '${(v * 100).toStringAsFixed(1)}%';

Future<Tally> run(String name, List<Case> cases, {required bool offline, required String? key}) async {
  const linker = ExerciseLinker();
  final t = Tally();
  for (final c in cases) {
    t.videos++;
    t.truthN += c.truth.length;
    final text = await fetch(c.url, offline: offline, key: key);
    if (text == null) {
      t.failed++;
      stdout.writeln('  [$name] 응답 없음: ${c.url}');
      continue;
    }
    List<ExtractedExercise> got;
    try {
      got = parseExtraction(text).exercises;
    } on ExtractError catch (e) {
      t.failed++;
      stdout.writeln('  [$name] ${e.message}: ${c.url}');
      continue;
    }
    t.predN += got.length;
    // 연결된 종목 id 로 정답과 짝짓는다(같은 종목은 한 번씩만).
    final remaining = [...c.truth];
    for (final g in got) {
      final id = linker.link(g.name, nameEnglish: g.nameEnglish, equipment: g.equipment).exercise?.id;
      final i = remaining.indexWhere((x) => x.exerciseId == id);
      if (i < 0) continue;
      final truth = remaining.removeAt(i);
      t.hit++;
      if (g.sets == truth.sets) t.setsRight++;
      if (g.repsMin == truth.repsMin && g.repsMax == truth.repsMax) t.repsRight++;
    }
  }
  return t;
}

Future<void> main(List<String> args) async {
  final offline = args.contains('--offline');
  final key = Platform.environment['GEMINI_API_KEY'];
  if (!offline && key == null) {
    stderr.writeln('GEMINI_API_KEY 가 없어요. 저장된 응답만 채점하려면 --offline');
    exit(64);
  }
  final tune = loadSplit('tune'), holdout = loadSplit('holdout');
  if (tune.isEmpty && holdout.isEmpty) {
    stderr.writeln('$_dir/routines/tune.json, holdout.json 에 영상과 정답을 넣어 주세요(형식은 파일 맨 위 주석)');
    exit(65);
  }
  stdout.writeln('모델 $extractModel, tune ${tune.length}개, holdout ${holdout.length}개\n');
  stdout.writeln('          영상  실패  종목재현율  종목정밀도  종목F1  세트일치  횟수일치');
  for (final (name, cases) in [('tune', tune), ('holdout', holdout)]) {
    if (cases.isEmpty) continue;
    final t = await run(name, cases, offline: offline, key: key);
    stdout.writeln('${name.padRight(9)}${'${t.videos}'.padLeft(4)}  ${'${t.failed}'.padLeft(4)}  '
        '${pct(t.recall).padLeft(9)}  ${pct(t.precision).padLeft(9)}  ${pct(t.f1).padLeft(6)}  '
        '${pct(t.hit == 0 ? 0 : t.setsRight / t.hit).padLeft(7)}  ${pct(t.hit == 0 ? 0 : t.repsRight / t.hit).padLeft(7)}');
  }
  stdout.writeln('\n세트·횟수 일치는 종목이 맞은 줄만 센다. 성공 판단은 holdout 만 본다(D15).');
}
