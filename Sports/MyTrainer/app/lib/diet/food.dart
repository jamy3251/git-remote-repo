import 'package:meta/meta.dart';

import 'nutrients.dart';

/// 음식 DB 한 건. 영양은 100g(음료 등은 100ml) 기준이다.
///
/// 자산 파일 한 줄(탭 구분): 코드, 이름, 분류, 제조사, 단위(g|ml), kcal, 탄, 단, 지, 1회 제공량.
/// 만드는 쪽은 tool/food_db/build_food_db.dart.
@immutable
class Food {
  const Food({
    required this.code,
    required this.name,
    required this.per100,
    this.category = '',
    this.maker = '',
    this.unit = 'g',
    this.servingSize,
  });

  final String code;
  final String name;
  final String category;

  /// 가공식품만. 일반 음식은 빈 문자열.
  final String maker;

  /// 'g' 또는 'ml'.
  final String unit;
  final Nutrients per100;

  /// 1회 제공량(g 또는 ml). 모르면 null.
  final double? servingSize;

  /// 양을 고를 때 처음 보여줄 값.
  double get defaultAmount => servingSize ?? 100;

  Nutrients forAmount(double amount) => per100 * (amount / 100);

  String get label => maker.isEmpty ? name : '$name · $maker';

  static const columns = 10;

  String toTsv() => [
        code,
        _clean(name),
        _clean(category),
        _clean(maker),
        unit,
        _num(per100.kcal),
        _num(per100.carb),
        _num(per100.protein),
        _num(per100.fat),
        servingSize == null ? '' : _num(servingSize!),
      ].join('\t');

  /// 형식이 어긋난 줄은 null.
  static Food? fromTsv(String line) {
    final c = line.split('\t');
    if (c.length < columns) return null;
    double? d(String s) => s.isEmpty ? null : double.tryParse(s);
    final kcal = d(c[5]), carb = d(c[6]), protein = d(c[7]), fat = d(c[8]);
    if (c[1].isEmpty || kcal == null) return null;
    return Food(
      code: c[0],
      name: c[1],
      category: c[2],
      maker: c[3],
      unit: c[4] == 'ml' ? 'ml' : 'g',
      per100: Nutrients(kcal: kcal, carb: carb ?? 0, protein: protein ?? 0, fat: fat ?? 0),
      servingSize: d(c[9]),
    );
  }

  static String _clean(String s) => s.replaceAll(RegExp(r'[\t\r\n]+'), ' ').trim();

  static String _num(double v) {
    final r = (v * 100).round() / 100;
    return r == r.roundToDouble() ? r.toInt().toString() : r.toString();
  }
}

/// 검색용으로 공백·괄호·특수문자를 뺀 소문자.
String normalizeFoodName(String s) => s.toLowerCase().replaceAll(RegExp(r'[\s_\-·,()\[\]/]+'), '');

/// 음식 이름 검색. 자산 전체를 들고 있지 않고 이름만 펼쳐 둔 목록을 훑는다.
///
/// 순위: 정확히 같음 → 앞부분이 같음 → 어딘가 포함. 같은 순위면 일반 음식(제조사 없음)이
/// 먼저, 그다음 이름이 짧은 것(“닭가슴살”이 “닭가슴살 스테이크 갈릭맛”보다 먼저).
class FoodIndex {
  FoodIndex(List<String> lines)
      : _lines = lines,
        _keys = [for (final l in lines) normalizeFoodName(_nameOf(l))],
        _hasMaker = [for (final l in lines) _makerOf(l).isNotEmpty];

  final List<String> _lines;
  final List<String> _keys;
  final List<bool> _hasMaker;

  int get length => _lines.length;

  static String _nameOf(String line) {
    final a = line.indexOf('\t');
    final b = line.indexOf('\t', a + 1);
    return a < 0 || b < 0 ? '' : line.substring(a + 1, b);
  }

  static String _makerOf(String line) => line.split('\t').elementAtOrNull(3) ?? '';

  List<Food> search(String query, {int limit = 30}) {
    final q = normalizeFoodName(query);
    if (q.isEmpty) return const [];
    final hits = <(int rank, int index)>[];
    for (var i = 0; i < _keys.length; i++) {
      final k = _keys[i];
      final int base;
      if (k == q) {
        base = 0;
      } else if (k.startsWith(q)) {
        base = 1;
      } else if (k.contains(q)) {
        base = 2;
      } else {
        continue;
      }
      hits.add((base * 2 + (_hasMaker[i] ? 1 : 0), i));
    }
    hits.sort((a, b) {
      final r = a.$1.compareTo(b.$1);
      if (r != 0) return r;
      final l = _keys[a.$2].length.compareTo(_keys[b.$2].length);
      return l != 0 ? l : a.$2.compareTo(b.$2);
    });
    return [
      for (final h in hits.take(limit))
        if (Food.fromTsv(_lines[h.$2]) case final f?) f,
    ];
  }

  /// 이름이 정확히 같은 일반 음식(없으면 제조사 있는 것). 추천 끼니의 기본 식재료 찾기에 쓴다.
  Food? exact(String name) {
    final q = normalizeFoodName(name);
    Food? branded;
    for (var i = 0; i < _keys.length; i++) {
      if (_keys[i] != q) continue;
      final f = Food.fromTsv(_lines[i]);
      if (f == null) continue;
      if (!_hasMaker[i]) return f;
      branded ??= f;
    }
    return branded;
  }
}
