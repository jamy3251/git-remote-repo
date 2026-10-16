import 'package:meta/meta.dart';

import 'price.dart';

/// 시세 원본(KAMIS·참가격) → 품목 값. tool/prices/build_prices.dart 가 쓰고, 순수 함수라 테스트한다.
///
/// 응답 필드 이름은 공개 문서 기준이고 실제 응답으로 아직 확인하지 않았다. 도구의 --sample 로 첫 응답을 보고 맞춘다.

/// KAMIS 에서 찾을 것. 부류 코드(100 식량작물, 200 채소, 400 과일, 500 축산, 600 수산)와 품목·품종 이름.
@immutable
class KamisSpec {
  const KamisSpec(this.category, this.item, {this.kind, this.countGrams});

  final String category;
  final String item;

  /// 품종 이름에 들어 있어야 하는 말(예: '특란', '앞다리'). null 이면 아무거나(첫 줄).
  final String? kind;

  /// '1마리'·'1포기'·'1개'처럼 개수 단위일 때 한 개 무게(g, 먹지 않는 부분 포함).
  final double? countGrams;
}

/// 품목 id → KAMIS 검색 조건. 없는 품목은 참가격 또는 참고값.
const kamisSpecs = <String, KamisSpec>{
  'egg': KamisSpec('500', '계란', kind: '특란', countGrams: 60),
  'pork_shoulder': KamisSpec('500', '돼지', kind: '앞다리'),
  'mackerel': KamisSpec('600', '고등어', countGrams: 350),
  'rice': KamisSpec('100', '쌀'),
  'brown_rice': KamisSpec('100', '현미'),
  'sweet_potato': KamisSpec('100', '고구마'),
  'potato': KamisSpec('100', '감자'),
  'banana': KamisSpec('400', '바나나'),
  'cabbage': KamisSpec('200', '양배추', countGrams: 2500),
  'broccoli': KamisSpec('200', '브로콜리', countGrams: 400),
  'spinach': KamisSpec('200', '시금치'),
  'carrot': KamisSpec('200', '당근'),
};

/// 품목 id → 참가격 상품명에 들어 있어야 하는 말.
const chamgaKeywords = <String, List<String>>{
  'chicken_breast': ['닭가슴살'],
  'tofu': ['두부'],
  'greek_yogurt': ['그릭'],
  'oats': ['오트밀'],
  'cooking_oil': ['콩기름', '식용유'],
  'peanut': ['땅콩'],
};

/// '1kg' '100g' '20kg' '30구' '10개' '1마리' 같은 단위 → g. 개수 단위는 [countGrams] 가 있어야 한다.
double? unitGrams(String unit, {double? countGrams}) {
  final u = unit.replaceAll(' ', '');
  final m = RegExp(r'^(\d+(?:\.\d+)?)(kg|g|L|ml|구|개|마리|포기|통|송이|단)').firstMatch(u);
  if (m == null) return null;
  final n = double.parse(m.group(1)!);
  return switch (m.group(2)) {
    'kg' => n * 1000,
    'L' => n * 1000,
    'g' || 'ml' => n,
    _ => countGrams == null ? null : n * countGrams,
  };
}

/// '7,180' → 7180. '-' 나 빈 값은 null.
double? parseWon(Object? v) {
  if (v == null) return null;
  final s = '$v'.replaceAll(',', '').trim();
  final n = double.tryParse(s);
  return n == null || n <= 0 ? null : n;
}

/// KAMIS 부류별 일일 가격 한 응답(data.item 줄들)에서 품목 값(우리 파는 단위 기준 원).
/// 같은 조건이 여러 줄이면(등급별) 가장 싼 값이 아니라 중간값을 쓴다.
int? kamisPrice(List<Map<String, dynamic>> rows, PriceItem item, KamisSpec spec) {
  final values = <double>[];
  for (final r in rows) {
    final name = '${r['item_name'] ?? ''}';
    final kind = '${r['kind_name'] ?? ''}';
    if (!name.contains(spec.item)) continue;
    if (spec.kind != null && !kind.contains(spec.kind!)) continue;
    final won = parseWon(r['dpr1']);
    // 단위는 unit 칸에, 없으면 품종 이름 괄호 안에 있다(예: '앞다리(100g)').
    final unit = '${r['unit'] ?? ''}'.isNotEmpty ? '${r['unit']}' : RegExp(r'\(([^)]+)\)').firstMatch(kind)?.group(1) ?? '';
    final g = unitGrams(unit, countGrams: spec.countGrams);
    if (won == null || g == null || g <= 0) continue;
    values.add(won / g * item.packGrams);
  }
  return values.isEmpty ? null : _median(values).round();
}

/// 참가격 상품 하나.
@immutable
class ChamgaGood {
  const ChamgaGood({required this.id, required this.name, required this.grams});

  final String id;
  final String name;

  /// 내용량(g 또는 ml).
  final double grams;
}

/// 상품 목록 한 줄(goodId, goodName, goodTotalCnt, goodTotalDivCode) → 상품. 무게를 모르면 null.
ChamgaGood? chamgaGood(Map<String, String> r) {
  final id = r['goodId'], name = r['goodName'];
  final cnt = double.tryParse(r['goodTotalCnt'] ?? '');
  final div = (r['goodTotalDivCode'] ?? '').toLowerCase();
  if (id == null || name == null || cnt == null || cnt <= 0) return null;
  final grams = switch (div) {
    'g' || 'ml' => cnt,
    'kg' || 'l' => cnt * 1000,
    _ => null,
  };
  return grams == null ? null : ChamgaGood(id: id, name: name, grams: grams);
}

/// 품목 id → 그 품목에 맞는 상품들.
Map<String, List<ChamgaGood>> chamgaMatch(List<ChamgaGood> goods) => {
      for (final e in chamgaKeywords.entries)
        e.key: [for (final g in goods) if (e.value.any(g.name.contains)) g],
    };

/// 매장별 판매가(goodId → 원 목록) → 품목 값(우리 파는 단위 기준, 1g 값의 중간값으로).
int? chamgaPrice(PriceItem item, List<ChamgaGood> goods, Map<String, List<double>> pricesByGood) {
  final perGram = <double>[
    for (final g in goods)
      for (final p in pricesByGood[g.id] ?? const <double>[])
        if (p > 0) p / g.grams,
  ];
  return perGram.isEmpty ? null : (_median(perGram) * item.packGrams).round();
}

/// 주소 맨 앞(시·도) → 시세 지역 이름. 참가격 매장을 KAMIS 지역에 붙일 때 쓴다.
String? regionOfAddress(String address) {
  const map = {
    '서울': '서울', '부산': '부산', '대구': '대구', '인천': '인천', '광주': '광주', '대전': '대전', '울산': '울산',
    '세종': '세종', '경기': '수원', '강원': '춘천', '충북': '청주', '충청북': '청주', '충남': '천안', '충청남': '천안',
    '전북': '전주', '전라북': '전주', '전남': '순천', '전라남': '순천', '경북': '포항', '경상북': '포항',
    '경남': '창원', '경상남': '창원', '제주': '제주',
  };
  final a = address.trim();
  for (final e in map.entries) {
    if (a.startsWith(e.key)) return e.value;
  }
  return null;
}

double _median(List<double> v) {
  final s = [...v]..sort();
  final m = s.length ~/ 2;
  return s.length.isOdd ? s[m] : (s[m - 1] + s[m]) / 2;
}
