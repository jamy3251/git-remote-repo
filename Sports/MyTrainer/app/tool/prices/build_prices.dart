// 지역 식재료 시세 → 앱 자산(assets/prices/prices.json). 설계 "추가 범위" N6.
//
// 1) KAMIS 지역별 일일 소매가(농축수산물: 달걀·돼지고기·고등어·쌀·고구마·채소 등)
//      KAMIS_KEY=<인증키> KAMIS_ID=<신청 아이디> dart run tool/prices/build_prices.dart --kamis
//    kamis.or.kr → 회원가입 → Open-API 이용 신청. 키와 아이디를 둘 다 넣는다.
// 2) 한국소비자원 참가격(가공식품: 닭가슴살·두부·오트밀·식용유 등, 매장별 판매가)
//      DATA_GO_KR_KEY=<일반 인증키> dart run tool/prices/build_prices.dart --chamga
//    data.go.kr 에서 "한국소비자원_생필품 가격 정보" 활용신청(식약처 DB 와 같은 키).
// 둘 다 쓰려면 --kamis --chamga. 처음에는 --sample 로 원본 첫 응답만 본다(필드 이름 확인용).
//
// 선택:
//   --date 2026-10-10        KAMIS 기준일(기본: 오늘부터 7일 안에서 값이 있는 가장 최근 날)
//   --regions 1101,2100      KAMIS 지역 코드 일부만
// 응답은 tool/prices/cache/ 에 남는다(커밋하지 않음). 기존 prices.json 의 다른 출처 값은 유지한다.
import 'dart:convert';
import 'dart:io';

import 'package:mytrainer/diet/price.dart';
import 'package:mytrainer/diet/price_source.dart';

const _dir = 'tool/prices';
const _out = 'assets/prices/prices.json';
const _kamisUrl = 'http://www.kamis.or.kr/service/price/xml.do';
const _chamgaUrl = 'http://openapi.price.go.kr/openApiImpl/ProductPriceInfoService';

/// KAMIS 소매가 조사 지역(코드, 이름, 시청 좌표). 앱은 헬스장에서 가장 가까운 곳을 쓴다.
const _regions = <(String, String, double, double)>[
  ('1101', '서울', 37.5665, 126.9780),
  ('2100', '부산', 35.1796, 129.0756),
  ('2200', '대구', 35.8714, 128.6014),
  ('2300', '인천', 37.4563, 126.7052),
  ('2401', '광주', 35.1595, 126.8526),
  ('2501', '대전', 36.3504, 127.3845),
  ('2601', '울산', 35.5384, 129.3114),
  ('3111', '수원', 37.2636, 127.0286),
  ('3211', '춘천', 37.8813, 127.7298),
  ('3311', '청주', 36.6424, 127.4890),
  ('3511', '전주', 35.8242, 127.1480),
  ('3711', '포항', 36.0190, 129.3435),
  ('3911', '제주', 33.4996, 126.5312),
  ('3113', '의정부', 37.7381, 127.0337),
  ('3613', '순천', 34.9507, 127.4872),
  ('3714', '안동', 36.5684, 128.7294),
  ('3814', '창원', 35.2281, 128.6811),
  ('3145', '용인', 37.2411, 127.1776),
  ('2701', '세종', 36.4800, 127.2890),
  ('3112', '성남', 37.4200, 127.1265),
  ('3138', '고양', 37.6584, 126.8320),
  ('3411', '천안', 36.8151, 127.1139),
  ('3818', '김해', 35.2285, 128.8894),
];

Future<void> main(List<String> args) async {
  String? opt(String name) {
    final i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  }

  final sample = args.contains('--sample');
  final kamis = args.contains('--kamis');
  final chamga = args.contains('--chamga');
  if (!kamis && !chamga) {
    stderr.writeln('--kamis 또는 --chamga 를 주세요(사용법은 파일 맨 위 주석).');
    exit(64);
  }
  Directory('$_dir/cache').createSync(recursive: true);

  // 기존 자산을 읽어 이번에 받지 않는 출처 값은 남긴다.
  final regionPrices = <String, Map<String, Map<String, Object?>>>{for (final r in _regions) r.$2: {}};
  final national = <String, Map<String, Object?>>{};
  final old = File(_out);
  if (old.existsSync()) {
    final j = jsonDecode(old.readAsStringSync()) as Map;
    for (final r in (j['regions'] as List? ?? const []).cast<Map>()) {
      final keep = regionPrices[r['name']];
      if (keep == null) continue;
      (r['prices'] as Map? ?? {}).forEach((k, v) => keep[k as String] = (v as Map).cast());
    }
    (j['national'] as Map? ?? {}).forEach((k, v) => national[k as String] = (v as Map).cast());
  }
  void drop(String source) {
    for (final m in [...regionPrices.values, national]) {
      m.removeWhere((_, v) => v['source'] == source);
    }
  }

  final client = HttpClient();
  try {
    if (kamis) {
      final key = Platform.environment['KAMIS_KEY'], id = Platform.environment['KAMIS_ID'];
      if (key == null || id == null) {
        stderr.writeln('KAMIS_KEY 와 KAMIS_ID 를 넣어 주세요.');
        exit(64);
      }
      final only = (opt('--regions') ?? '').split(',').where((s) => s.isNotEmpty).toSet();
      final fixedDate = opt('--date');
      drop('kamis');
      final perItem = <String, List<int>>{};
      for (final (code, name, _, _) in _regions) {
        if (only.isNotEmpty && !only.contains(code)) continue;
        final rows = <Map<String, dynamic>>[];
        String? date;
        for (final cat in {for (final s in kamisSpecs.values) s.category}) {
          final (r, d) = await _kamisCategory(client, key, id, code, cat, fixedDate);
          if (sample) {
            stdout.writeln('KAMIS $name 부류 $cat ($d) ${r.length}줄, 첫 줄 원본:');
            if (r.isNotEmpty) stdout.writeln(const JsonEncoder.withIndent('  ').convert(r.first));
            return;
          }
          rows.addAll(r);
          date ??= d;
        }
        var n = 0;
        for (final e in kamisSpecs.entries) {
          final item = priceItemById(e.key)!;
          final won = kamisPrice(rows, item, e.value);
          if (won == null) continue;
          regionPrices[name]![e.key] = {'won': won, 'source': 'kamis', 'date': date};
          (perItem[e.key] ??= []).add(won);
          n++;
        }
        stdout.writeln('KAMIS $name ($date): ${kamisSpecs.length}개 중 $n개');
      }
      for (final e in perItem.entries) {
        national[e.key] = {'won': _median(e.value), 'source': 'kamis', 'date': null};
      }
    }

    if (chamga) {
      final key = Platform.environment['DATA_GO_KR_KEY'];
      if (key == null) {
        stderr.writeln('DATA_GO_KR_KEY 를 넣어 주세요.');
        exit(64);
      }
      drop('chamga');
      await _chamga(client, key, sample, regionPrices, national);
    }
  } finally {
    client.close();
  }
  if (sample) return;

  final out = {
    'builtAt': DateTime.now().toIso8601String().substring(0, 10),
    'regions': [
      for (final (_, name, lat, lng) in _regions)
        if (regionPrices[name]!.isNotEmpty) {'name': name, 'lat': lat, 'lng': lng, 'prices': regionPrices[name]},
    ],
    'national': national,
  };
  File(_out)
    ..parent.createSync(recursive: true)
    ..writeAsStringSync(const JsonEncoder.withIndent(' ').convert(out));
  stdout.writeln('$_out: 지역 ${(out['regions'] as List).length}곳, 전국 값 ${national.length}개');
}

/// 한 지역·한 부류. 값이 없는 날(주말·공휴일)이면 하루씩 앞으로 7일까지.
Future<(List<Map<String, dynamic>>, String)> _kamisCategory(
    HttpClient client, String key, String id, String region, String cat, String? fixedDate) async {
  final start = fixedDate == null ? DateTime.now() : DateTime.parse(fixedDate);
  for (var back = 0; back < (fixedDate == null ? 7 : 1); back++) {
    final d = start.subtract(Duration(days: back)).toIso8601String().substring(0, 10);
    final file = File('$_dir/cache/kamis_${region}_${cat}_$d.json');
    final body = file.existsSync()
        ? file.readAsStringSync()
        : await _get(client, Uri.parse(_kamisUrl).replace(queryParameters: {
            'action': 'dailyPriceByCategoryList',
            'p_product_cls_code': '01', // 소매
            'p_item_category_code': cat,
            'p_country_code': region,
            'p_regday': d,
            'p_convert_kg_yn': 'N',
            'p_cert_key': key,
            'p_cert_id': id,
            'p_returntype': 'json',
          }));
    final data = (jsonDecode(body) as Map)['data'];
    // 값이 없으면 data 가 ["001"] 같은 오류 코드 목록으로 온다.
    final items = data is Map ? data['item'] : null;
    if (items is List && items.isNotEmpty) {
      file.writeAsStringSync(body);
      return ([for (final i in items) (i as Map).cast<String, dynamic>()], d);
    }
  }
  return (const <Map<String, dynamic>>[], fixedDate ?? '');
}

Future<void> _chamga(HttpClient client, String key, bool sample, Map<String, Map<String, Map<String, Object?>>> regionPrices,
    Map<String, Map<String, Object?>> national) async {
  Future<List<Map<String, String>>> list(String op, Map<String, String> q, String cacheName) async {
    final file = File('$_dir/cache/chamga_$cacheName.xml');
    final body = file.existsSync()
        ? file.readAsStringSync()
        : await _get(client, Uri.parse('$_chamgaUrl/$op').replace(queryParameters: {'serviceKey': key, ...q}));
    final rows = _xmlItems(body);
    if (rows.isNotEmpty) file.writeAsStringSync(body);
    return rows;
  }

  final goodsRaw = await list('getProductInfoSvc.do', const {}, 'goods');
  if (sample) {
    stdout.writeln('참가격 상품 ${goodsRaw.length}개, 첫 줄 원본: ${goodsRaw.firstOrNull}');
    final stores = await list('getStoreInfoSvc.do', const {}, 'stores');
    stdout.writeln('참가격 매장 ${stores.length}곳, 첫 줄 원본: ${stores.firstOrNull}');
    return;
  }
  final matched = chamgaMatch([for (final r in goodsRaw) if (chamgaGood(r) case final g?) g]);
  final stores = {
    for (final s in await list('getStoreInfoSvc.do', const {}, 'stores'))
      if (s['entpId'] != null) s['entpId']!: regionOfAddress(s['plmkAddrBasic'] ?? s['roadAddrBasic'] ?? ''),
  };

  // 조사는 격주 금요일. 최근 금요일부터 8주 안에서 값이 있는 날.
  var day = DateTime.now();
  while (day.weekday != DateTime.friday) {
    day = day.subtract(const Duration(days: 1));
  }
  for (final e in matched.entries) {
    if (e.value.isEmpty) {
      stdout.writeln('참가격 ${e.key}: 맞는 상품 없음');
      continue;
    }
    final byRegion = <String?, Map<String, List<double>>>{};
    String? found;
    for (var w = 0; w < 8 && found == null; w++) {
      final d = day.subtract(Duration(days: 7 * w));
      final ds = '${d.year}${'${d.month}'.padLeft(2, '0')}${'${d.day}'.padLeft(2, '0')}';
      for (final g in e.value.take(10)) {
        final rows = await list('getProductPriceInfoSvc.do', {'goodInspectDay': ds, 'goodId': g.id}, 'price_${g.id}_$ds');
        for (final r in rows) {
          final won = parseWon(r['goodPrice']);
          if (won == null) continue;
          final region = stores[r['entpId']];
          ((byRegion[region] ??= {})[g.id] ??= []).add(won);
          ((byRegion[null] ??= {})[g.id] ??= []).add(won); // 전국
          found = '${d.year}-${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}';
        }
      }
    }
    final item = priceItemById(e.key)!;
    for (final r in byRegion.entries) {
      final won = chamgaPrice(item, e.value, r.value);
      if (won == null) continue;
      final v = {'won': won, 'source': 'chamga', 'date': found};
      if (r.key == null) {
        national[e.key] = v;
      } else {
        regionPrices[r.key]?.putIfAbsent(e.key, () => v);
      }
    }
    stdout.writeln('참가격 ${item.name}: 상품 ${e.value.length}개, 지역 ${byRegion.length - 1}곳 ($found)');
  }
}

/// 참가격은 XML. 평평한 `<item>` 만 쓰니 정규식으로 충분하다.
List<Map<String, String>> _xmlItems(String xml) => [
      for (final m in RegExp(r'<item>(.*?)</item>', dotAll: true).allMatches(xml))
        {
          for (final f in RegExp(r'<(\w+)>([^<]*)</\1>').allMatches(m.group(1)!)) f.group(1)!: f.group(2)!.trim(),
        },
    ];

Future<String> _get(HttpClient client, Uri uri) async {
  for (var attempt = 1;; attempt++) {
    try {
      final req = await client.getUrl(uri);
      final res = await req.close().timeout(const Duration(seconds: 30));
      final body = await res.transform(utf8.decoder).join();
      if (res.statusCode == 200) return body;
      throw HttpException('${res.statusCode} ${body.length > 300 ? body.substring(0, 300) : body}');
    } catch (e) {
      if (attempt >= 3) rethrow;
      await Future<void>.delayed(Duration(seconds: 2 * attempt));
    }
  }
}

int _median(List<int> v) {
  final s = [...v]..sort();
  return s[s.length ~/ 2];
}
