// 식약처 식품영양성분 DB 원본(공공데이터포털 API 응답 또는 내려받은 CSV) → [Food].
// Flutter 없이 돈다(tool/food_db/build_food_db.dart 가 dart run 으로 씀).
import 'food.dart';
import 'nutrients.dart';

/// 원본 열 이름. API 는 영문 코드, CSV 는 한글 머리말이다.
class FoodColumns {
  const FoodColumns({
    required this.code,
    required this.name,
    required this.kcal,
    required this.carb,
    required this.protein,
    required this.fat,
    this.category,
    this.maker,
    this.basis,
    this.serving,
  });

  final String code, name, kcal, carb, protein, fat;
  final String? category, maker;

  /// 영양성분 함량 기준량("100g", "100mL"). 없으면 100g 으로 본다.
  final String? basis;

  /// 1회 섭취 참고량 또는 식품 중량("30g").
  final String? serving;

  /// 공공데이터포털 API(식품의약품안전처_식품영양성분DB정보)의 필드.
  /// AMT_NUM 번호는 식품성분표 순서(에너지, 수분, 단백질, 지방, 회분, 탄수화물 …)로 짐작한 것이라
  /// [checkColumns] 로 검산한다. 다르면 도구의 --map 으로 바꾼다.
  static const api = FoodColumns(
    code: 'FOOD_CD',
    name: 'FOOD_NM_KR',
    category: 'FOOD_CAT1_NM',
    maker: 'MAKER_NM',
    basis: 'SERVING_SIZE',
    serving: 'Z10500',
    kcal: 'AMT_NUM1',
    protein: 'AMT_NUM3',
    fat: 'AMT_NUM4',
    carb: 'AMT_NUM6',
  );

  /// CSV 머리말에서 찾는다. 공백은 무시하고 앞부분으로 맞춘다("에너지(kcal)", "탄수화물(g)").
  static FoodColumns? fromHeaders(List<String> headers) {
    String? find(List<String> prefixes, {List<String> not = const []}) {
      for (final p in prefixes) {
        for (final h in headers) {
          final k = h.replaceAll(RegExp(r'\s'), '');
          if (k.startsWith(p) && !not.any(k.startsWith)) return h;
        }
      }
      return null;
    }

    final code = find(['식품코드']);
    final name = find(['식품명']);
    final kcal = find(['에너지']);
    final carb = find(['탄수화물']);
    final protein = find(['단백질']);
    final fat = find(['지방'], not: ['지방산']);
    if (code == null || name == null || kcal == null || carb == null || protein == null || fat == null) {
      return null;
    }
    return FoodColumns(
      code: code,
      name: name,
      kcal: kcal,
      carb: carb,
      protein: protein,
      fat: fat,
      category: find(['식품대분류명', '대표식품명', '식품분류']),
      maker: find(['제조사명', '업체명']),
      basis: find(['영양성분함량기준량']),
      serving: find(['1회섭취참고량', '식품중량']),
    );
  }

  FoodColumns copyWith(Map<String, String> m) => FoodColumns(
        code: m['code'] ?? code,
        name: m['name'] ?? name,
        kcal: m['kcal'] ?? kcal,
        carb: m['carb'] ?? carb,
        protein: m['protein'] ?? protein,
        fat: m['fat'] ?? fat,
        category: m['category'] ?? category,
        maker: m['maker'] ?? maker,
        basis: m['basis'] ?? basis,
        serving: m['serving'] ?? serving,
      );
}

/// "100g", "100 mL", "1회(30g)" 같은 값에서 (양, 단위). 숫자가 없으면 null.
(double, String)? parseAmount(String? s) {
  if (s == null) return null;
  final m = RegExp(r'([\d.]+)\s*(g|ml|mL|ML|그램)?').allMatches(s).lastOrNull;
  final v = m == null ? null : double.tryParse(m.group(1)!);
  if (v == null || v <= 0) return null;
  final unit = (m!.group(2) ?? 'g').toLowerCase() == 'ml' ? 'ml' : 'g';
  return (v, unit);
}

double? _num(Object? v) {
  if (v == null) return null;
  final s = v.toString().replaceAll(',', '').trim();
  if (s.isEmpty || s == '-') return null;
  return double.tryParse(s);
}

/// 원본 한 건 → [Food](100 기준으로 환산). 이름이나 열량이 없으면 null.
/// 탄·단·지가 비어 있으면 0 이 아니라 "모름"이지만, 앱은 합계에 0 으로 더한다.
Food? foodFromRecord(Map<String, Object?> r, FoodColumns c) {
  final name = r[c.name]?.toString().trim() ?? '';
  final kcal = _num(r[c.kcal]);
  if (name.isEmpty || kcal == null) return null;
  final basis = parseAmount(r[c.basis]?.toString()) ?? (100.0, 'g');
  final k = 100 / basis.$1;
  final serving = parseAmount(r[c.serving]?.toString());
  final maker = c.maker == null ? '' : (r[c.maker]?.toString().trim() ?? '');
  return Food(
    code: r[c.code]?.toString().trim() ?? '',
    name: name,
    category: c.category == null ? '' : (r[c.category]?.toString().trim() ?? ''),
    // 일반 음식은 제조사 칸이 "해당없음"·"-" 등으로 온다.
    maker: const {'해당없음', '-', '없음'}.contains(maker) ? '' : maker,
    unit: basis.$2,
    per100: Nutrients(
      kcal: kcal * k,
      carb: (_num(r[c.carb]) ?? 0) * k,
      protein: (_num(r[c.protein]) ?? 0) * k,
      fat: (_num(r[c.fat]) ?? 0) * k,
    ),
    servingSize: serving?.$1,
  );
}

/// 열 매핑 검산 결과.
class ColumnCheck {
  ColumnCheck({required this.checked, required this.atwaterOff, required this.anchorProblems});

  /// 검산에 쓴 건수(열량 50kcal 이상, 3대 영양소가 다 있는 것).
  final int checked;

  /// 4C+4P+9F 가 표시 열량과 30% 넘게 다른 비율. 알코올·당알코올·식이섬유 때문에 조금은 생긴다.
  final double atwaterOff;

  /// 상식 확인에 걸린 것("닭가슴살인데 탄수화물이 단백질보다 많다" 등).
  final List<String> anchorProblems;

  bool get ok => checked >= 20 && atwaterOff < 0.2 && anchorProblems.isEmpty;

  @override
  String toString() => '검산 $checked건, 열량 불일치 ${(atwaterOff * 100).toStringAsFixed(1)}%'
      '${anchorProblems.isEmpty ? '' : ', 상식 확인 실패: ${anchorProblems.join(' / ')}'}';
}

/// 탄수화물과 단백질은 둘 다 1g 에 4kcal 라 열량 검산으로는 서로 바뀐 것을 못 잡는다.
/// 그래서 이름으로 확실한 음식 몇 개를 같이 본다.
ColumnCheck checkColumns(Iterable<Food> foods) {
  var checked = 0, off = 0;
  final problems = <String>{};
  for (final f in foods) {
    final n = f.per100;
    if (n.kcal >= 50 && (n.carb + n.protein + n.fat) > 0) {
      checked++;
      if ((n.atwaterKcal - n.kcal).abs() / n.kcal > 0.3) off++;
    }
    if (f.maker.isNotEmpty) continue;
    if (f.name.contains('닭가슴살') && n.carb > n.protein) problems.add('닭가슴살 탄>단');
    if ((f.name == '쌀밥' || f.name.startsWith('백미밥')) && n.protein > n.carb) problems.add('쌀밥 단>탄');
    if (f.name.contains('식용유') && n.fat < n.carb) problems.add('식용유 지<탄');
  }
  return ColumnCheck(checked: checked, atwaterOff: checked == 0 ? 1 : off / checked, anchorProblems: problems.toList());
}
