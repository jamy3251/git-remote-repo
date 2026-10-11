// 식약처 식품영양성분 DB → 앱 자산(assets/foods/foods.tsv.gz). 설계 "추가 범위" N2.
//
// 1) 공공데이터포털 API (식품의약품안전처_식품영양성분DB정보, data.go.kr/data/15127578)
//      DATA_GO_KR_KEY=<일반 인증키(Decoding)> dart run tool/food_db/build_food_db.dart --api
//    받은 페이지는 tool/food_db/cache/ 에 남아서 끊겨도 이어 받는다(커밋하지 않음).
//    처음에는 --sample 로 한 페이지만 받아 첫 행 원본과 검산 결과를 본다.
// 2) 내려받은 CSV(UTF-8, 첫 줄 머리말). 엑셀에서 "CSV UTF-8" 로 저장해 주세요.
//      dart run tool/food_db/build_food_db.dart --csv 음식.csv --csv 가공식품.csv
//
// 선택:
//   --map carb=AMT_NUM7,protein=AMT_NUM3   열 이름 바꾸기(검산이 실패하면 출력된 첫 행을 보고 고친다)
//   --only 음식,농축산물                    분류(category) 앞부분이 맞는 것만(APK 크기 줄이기)
//   --endpoint <url>                         API 주소가 바뀌었을 때
//   --force                                  검산이 실패해도 쓰기
import 'dart:convert';
import 'dart:io';

import 'package:mytrainer/diet/food.dart';
import 'package:mytrainer/diet/food_source.dart';

const _dir = 'tool/food_db';
const _out = 'assets/foods/foods.tsv.gz';
const _defaultEndpoint = 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02';
const _pageSize = 100;

Future<void> main(List<String> args) async {
  String? opt(String name) {
    final i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  }

  List<String> opts(String name) => [
        for (var i = 0; i < args.length - 1; i++)
          if (args[i] == name) args[i + 1],
      ];

  final overrides = <String, String>{
    for (final kv in (opt('--map') ?? '').split(',').where((s) => s.contains('=')))
      kv.split('=')[0].trim(): kv.split('=')[1].trim(),
  };
  final only = (opt('--only') ?? '').split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
  final force = args.contains('--force');

  List<Food> foods;
  if (args.contains('--api') || args.contains('--sample')) {
    final key = Platform.environment['DATA_GO_KR_KEY'];
    if (key == null || key.isEmpty) {
      stderr.writeln('DATA_GO_KR_KEY 가 없어요. data.go.kr 에서 활용신청 후 일반 인증키(Decoding)를 넣어 주세요.');
      exit(64);
    }
    foods = await _fromApi(key,
        endpoint: opt('--endpoint') ?? _defaultEndpoint,
        columns: FoodColumns.api.copyWith(overrides),
        sampleOnly: args.contains('--sample'));
  } else if (opts('--csv').isNotEmpty) {
    foods = [for (final f in opts('--csv')) ..._fromCsv(f, overrides)];
  } else {
    stderr.writeln('--api 또는 --csv <파일> 을 주세요(사용법은 파일 맨 위 주석).');
    exit(64);
  }

  if (only.isNotEmpty) {
    foods = foods.where((f) => only.any(f.category.startsWith)).toList();
  }

  // 같은 이름·제조사는 하나만(가공식품은 같은 제품이 여러 번 신고되어 있다).
  final seen = <String>{};
  foods = [
    for (final f in foods)
      if (seen.add('${normalizeFoodName(f.name)}|${f.maker}')) f,
  ];

  final check = checkColumns(foods);
  stdout.writeln('${foods.length}건 · $check');
  if (!check.ok && !force) {
    stderr.writeln('열 매핑이 맞지 않는 것 같아요. 위의 첫 행 원본을 보고 --map 으로 고치거나, 확인했으면 --force.');
    exit(65);
  }
  if (args.contains('--sample')) return;

  final tsv = foods.map((f) => f.toTsv()).join('\n');
  final out = File(_out)..parent.createSync(recursive: true);
  out.writeAsBytesSync(gzip.encode(utf8.encode(tsv)));
  stdout.writeln('$_out ${(out.lengthSync() / 1024 / 1024).toStringAsFixed(1)}MB');
}

Future<List<Food>> _fromApi(String key,
    {required String endpoint, required FoodColumns columns, required bool sampleOnly}) async {
  final cache = Directory('$_dir/cache')..createSync(recursive: true);
  final client = HttpClient();
  final foods = <Food>[];
  try {
    var total = -1;
    for (var page = 1; total < 0 || (page - 1) * _pageSize < total; page++) {
      final file = File('${cache.path}/page_$page.json');
      String body;
      if (file.existsSync()) {
        body = file.readAsStringSync();
      } else {
        body = await _get(client, endpoint, key, page);
        file.writeAsStringSync(body);
      }
      final (items, count) = _parsePage(body);
      total = count;
      if (page == 1) {
        stdout.writeln('전체 $total건, 첫 행 원본:');
        if (items.isNotEmpty) stdout.writeln(const JsonEncoder.withIndent('  ').convert(items.first));
      }
      for (final r in items) {
        final f = foodFromRecord(r, columns);
        if (f != null) foods.add(f);
      }
      if (sampleOnly || items.isEmpty) break;
      if (page % 50 == 0) stdout.writeln('  $page쪽 · ${foods.length}건');
    }
  } finally {
    client.close();
  }
  return foods;
}

Future<String> _get(HttpClient client, String endpoint, String key, int page) async {
  final uri = Uri.parse(endpoint).replace(queryParameters: {
    'serviceKey': key,
    'pageNo': '$page',
    'numOfRows': '$_pageSize',
    'type': 'json',
  });
  for (var attempt = 1;; attempt++) {
    try {
      final req = await client.getUrl(uri);
      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      if (res.statusCode == 200 && body.trimLeft().startsWith('{')) return body;
      throw HttpException('${res.statusCode} ${body.length > 300 ? body.substring(0, 300) : body}');
    } catch (e) {
      if (attempt >= 4) {
        stderr.writeln('$page쪽 받기 실패: $e');
        rethrow;
      }
      await Future<void>.delayed(Duration(seconds: 2 * attempt));
    }
  }
}

/// 공공데이터포털 JSON 은 body.items 가 배열이거나 {item: [...]} 이다.
(List<Map<String, Object?>>, int) _parsePage(String body) {
  final j = jsonDecode(body) as Map;
  final header = (j['header'] ?? (j['response'] as Map?)?['header']) as Map?;
  final code = header?['resultCode']?.toString();
  if (code != null && code != '00') throw StateError('API 오류 $code ${header?['resultMsg']}');
  final b = (j['body'] ?? (j['response'] as Map?)?['body']) as Map? ?? const {};
  Object? items = b['items'];
  if (items is Map) items = items['item'];
  if (items is Map) items = [items];
  final list = [for (final i in (items as List?) ?? const []) (i as Map).cast<String, Object?>()];
  return (list, int.tryParse('${b['totalCount']}') ?? list.length);
}

List<Food> _fromCsv(String path, Map<String, String> overrides) {
  final bytes = File(path).readAsBytesSync();
  final String text;
  try {
    text = utf8.decode(bytes).replaceFirst('﻿', '');
  } on FormatException {
    stderr.writeln('$path 가 UTF-8 이 아니에요(아마 CP949). 엑셀에서 "CSV UTF-8" 로 다시 저장해 주세요.');
    exit(66);
  }
  final rows = parseCsv(text);
  if (rows.isEmpty) return const [];
  final columns = FoodColumns.fromHeaders(rows.first)?.copyWith(overrides);
  if (columns == null) {
    stderr.writeln('$path 머리말에서 식품코드·식품명·에너지·탄수화물·단백질·지방 열을 못 찾았어요: ${rows.first.take(20).join(', ')}');
    exit(65);
  }
  final out = <Food>[];
  for (final r in rows.skip(1)) {
    final rec = <String, Object?>{for (var i = 0; i < rows.first.length && i < r.length; i++) rows.first[i]: r[i]};
    final f = foodFromRecord(rec, columns);
    if (f != null) out.add(f);
  }
  stdout.writeln('$path ${out.length}건');
  return out;
}

/// 따옴표·쉼표·줄바꿈이 든 칸을 처리하는 CSV 읽기.
List<List<String>> parseCsv(String text) {
  final rows = <List<String>>[];
  var row = <String>[];
  final cell = StringBuffer();
  var quoted = false;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (quoted) {
      if (ch == '"') {
        if (i + 1 < text.length && text[i + 1] == '"') {
          cell.write('"');
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell.write(ch);
      }
    } else if (ch == '"') {
      quoted = true;
    } else if (ch == ',') {
      row.add(cell.toString());
      cell.clear();
    } else if (ch == '\n' || ch == '\r') {
      if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      row.add(cell.toString());
      cell.clear();
      if (row.any((c) => c.isNotEmpty)) rows.add(row);
      row = <String>[];
    } else {
      cell.write(ch);
    }
  }
  row.add(cell.toString());
  if (row.any((c) => c.isNotEmpty)) rows.add(row);
  return rows;
}
