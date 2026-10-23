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

/// 참가격(한국소비자원 생필품 가격 정보)에서 찾을 것. 상품명에 [include] 중 하나가 있고 [exclude] 는 없어야 한다.
@immutable
class ChamgaSpec {
  const ChamgaSpec(this.include, {this.exclude = const [], this.countGrams, this.minGrams = 0});

  final List<String> include;
  final List<String> exclude;

  /// '(10개)' 처럼 개수로 파는 상품의 한 개 무게(g).
  final double? countGrams;

  /// 이보다 작은 상품은 뺀다(쌀 이름이 든 떡볶이·고추장 등을 거르는 용도).
  final double minGrams;
}

/// 품목 id → 참가격 검색 조건. KAMIS 에도 있는 품목(쌀·현미)은 KAMIS 값이 먼저다.
/// 달걀은 조사 품목이 브랜드 계란뿐이라(2026-09, 30구 환산 약 2만 원) 시세로 쓰지 않고 KAMIS 만 쓴다.
/// 닭가슴살·그릭요거트·오트밀은 2026-09 조사 품목에 없지만, 나중에 들어오면 잡히게 남겨 둔다.
const chamgaSpecs = <String, ChamgaSpec>{
  'chicken_breast': ChamgaSpec(['닭가슴살'], exclude: ['소시지', '볼', '만두', '샐러드']),
  'tofu': ChamgaSpec(['두부'], exclude: ['진밥', '유부', '과자']),
  'greek_yogurt': ChamgaSpec(['그릭']),
  'oats': ChamgaSpec(['오트밀', '귀리'], exclude: ['음료', '우유', '바']),
  'cooking_oil': ChamgaSpec(['식용유', '콩기름']),
  'peanut': ChamgaSpec(['땅콩'], exclude: ['버터', '샌드', '캔디', '과자', '쿠키', '크림', '바', '잼']),
  'rice': ChamgaSpec(['쌀'], exclude: ['현미', '찹쌀', '흑미', '만두', '떡', '고추장', '국수', '과자', '식초', '음료'], minGrams: 4000),
  'brown_rice': ChamgaSpec(['현미'], exclude: ['고추장', '식초', '녹차', '차', '음료', '과자'], minGrams: 1000),
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

/// 참가격 한 줄(상품명·판매가격). 무게를 알고 정상가인 줄만.
@immutable
class ChamgaRow {
  const ChamgaRow({required this.name, required this.grams, required this.won, this.day});

  final String name;

  /// 내용량(g 또는 ml).
  final double grams;
  final double won;

  /// 조사일(yyyy-MM-dd).
  final String? day;
}

/// 상품명 괄호 안 내용량 → g. '(380g)' '(1.5L)' '(100g*5)' '(10개)'. 개수는 [countGrams] 가 있어야 한다.
double? gramsInName(String name, {double? countGrams}) {
  final groups = RegExp(r'\(([^)]*)\)').allMatches(name).toList();
  if (groups.isEmpty) return null;
  final m = RegExp(r'(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|L|l|개|구)(?:\s*[x×*X]\s*(\d+))?')
      .firstMatch(groups.last.group(1)!);
  if (m == null) return null;
  final n = double.parse(m.group(1)!);
  final times = double.tryParse(m.group(3) ?? '') ?? 1;
  final g = switch (m.group(2)) {
    'kg' || 'L' || 'l' => n * 1000,
    'g' || 'ml' || 'mL' => n,
    _ => countGrams == null ? null : n * countGrams,
  };
  return g == null ? null : g * times;
}

/// 원본 한 줄 → [ChamgaRow]. 세일·1+1 값은 평소 가격이 아니라서 뺀다.
ChamgaRow? chamgaRow(Map<String, dynamic> r, ChamgaSpec spec) {
  final name = '${r['상품명'] ?? ''}';
  if (!spec.include.any(name.contains) || spec.exclude.any(name.contains)) return null;
  if (r['세일여부'] == 'Y' || r['원플러스원'] == 'Y') return null;
  final won = parseWon(r['판매가격']);
  final g = gramsInName(name, countGrams: spec.countGrams);
  if (won == null || g == null || g < spec.minGrams || g <= 0) return null;
  return ChamgaRow(name: name, grams: g, won: won, day: r['조사일'] as String?);
}

/// 맞는 줄들의 1g 값 중간값 → 품목 값(우리 파는 단위 기준 원).
int? chamgaPrice(PriceItem item, List<ChamgaRow> rows) {
  final perGram = [for (final r in rows) r.won / r.grams];
  return perGram.isEmpty ? null : (_median(perGram) * item.packGrams).round();
}

double _median(List<double> v) {
  final s = [...v]..sort();
  final m = s.length ~/ 2;
  return s.length.isOdd ? s[m] : (s[m - 1] + s[m]) / 2;
}
