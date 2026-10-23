import 'dart:convert';
import 'dart:math' as math;

import 'package:meta/meta.dart';

import 'food.dart';
import 'nutrients.dart';

/// 장보기 식단(설계 추가 범위 N6). 동네에서 실제로 사는 식재료의 값과 영양으로 하루 식단을 짜고 값을 보인다.
///
/// 가격: assets/prices/prices.json(tool/prices/build_prices.dart 가 KAMIS 지역별 소매가·
/// 한국소비자원 참가격으로 만든다) → 없으면 아래 [PriceItem.basePrice](참고값). 사용자가 고친 값이 늘 먼저.
/// 영양: 식약처 DB 에 [PriceItem.dbNames] 와 이름이 같은 것이 있으면 그 값, 없으면 [PriceItem.per100].

enum FoodRole { protein, carb, veg, fat }

/// 장보기 단위 하나.
@immutable
class PriceItem {
  const PriceItem({
    required this.id,
    required this.name,
    required this.role,
    required this.per100,
    required this.packLabel,
    required this.packGrams,
    required this.basePrice,
    this.edible = 1.0,
    this.maxPerMeal = 300,
    this.dbNames = const [],
    this.cooked,
    this.pieceGrams,
    this.pieceLabel,
    this.group,
    this.mealItem = true,
  });

  final String id;
  final String name;
  final FoodRole role;

  /// 먹는 부분 100g 의 생것 기준 영양(DB 에 없을 때 쓰는 값).
  final Nutrients per100;

  /// 파는 단위 표시(예: '1kg', '30구', '1모 300g')와 그 무게(g, 우유는 ml).
  final String packLabel;
  final double packGrams;

  /// 껍질·뼈·머리를 뺀 먹는 부분 비율.
  final double edible;

  /// 참고 가격(원/파는 단위). 2026년 10월 대형마트·전통시장 소매가를 어림한 값이라 받은 시세가 있으면 쓰지 않는다.
  final int basePrice;

  /// 한 끼 최대 양(먹는 부분 g).
  final double maxPerMeal;

  /// 식약처 DB 에서 찾을 이름(앞이 먼저). 같은 이름의 가공식품(말린 바나나 등)이 걸리지 않게 '생것' 원재료 이름을 쓴다.
  /// 비어 있으면 기본값만(그릭요거트·닭다리살 정육·양식 연어처럼 DB 원재료와 다른 것).
  final List<String> dbNames;

  /// 익히면 무게가 몇 배인지(쌀 → 밥). 화면에 '밥 약 230g' 처럼 보이는 데만 쓴다.
  final double? cooked;

  /// 개수로 보이면 편한 것(달걀 1개 50g).
  final double? pieceGrams;
  final String? pieceLabel;

  /// 거의 같은 식재료끼리 묶는 이름(닭가슴살·닭안심). 식단에서 단백질이 겹치는지 볼 때 쓴다. 없으면 [id].
  final String? group;

  /// 끼니 재료로 쓰는지. 보충제처럼 끼니가 아닌 것은 false(값 목록에만 보인다).
  final bool mealItem;

  String get groupId => group ?? id;
}

/// 다이어트 식단에 흔히 쓰는 식재료. 단백질 16, 탄수화물 6, 채소 4, 지방 2.
const priceCatalog = <PriceItem>[
  PriceItem(
    id: 'chicken_breast', name: '닭가슴살', role: FoodRole.protein,
    per100: Nutrients(kcal: 109, carb: 0, protein: 22.9, fat: 1.2),
    packLabel: '냉동 1kg', packGrams: 1000, basePrice: 9900, maxPerMeal: 250,
    dbNames: ['닭고기, 가슴, 생것', '닭가슴살'],
  ),
  PriceItem(
    id: 'egg', name: '달걀', role: FoodRole.protein,
    per100: Nutrients(kcal: 143, carb: 0.7, protein: 12.6, fat: 9.5),
    packLabel: '특란 30구', packGrams: 30 * 60, edible: 0.88, basePrice: 7000, maxPerMeal: 160,
    dbNames: ['달걀, 생것'], pieceGrams: 53, pieceLabel: '개',
  ),
  PriceItem(
    id: 'tofu', name: '두부', role: FoodRole.protein,
    per100: Nutrients(kcal: 90, carb: 2.5, protein: 9.0, fat: 5.0),
    packLabel: '1모 300g', packGrams: 300, basePrice: 2000, maxPerMeal: 300,
    dbNames: ['두부'],
  ),
  PriceItem(
    id: 'pork_shoulder', name: '돼지 앞다리살', role: FoodRole.protein,
    per100: Nutrients(kcal: 175, carb: 0, protein: 19.0, fat: 11.0),
    packLabel: '100g', packGrams: 100, basePrice: 1500, maxPerMeal: 200,
    dbNames: ['돼지고기, 앞다리, 생것'],
  ),
  PriceItem(
    id: 'mackerel', name: '고등어', role: FoodRole.protein,
    per100: Nutrients(kcal: 183, carb: 0, protein: 20.2, fat: 11.5),
    packLabel: '1마리', packGrams: 350, edible: 0.6, basePrice: 4000, maxPerMeal: 200,
    dbNames: ['고등어, 생것'],
  ),
  PriceItem(
    id: 'greek_yogurt', name: '그릭요거트', role: FoodRole.protein,
    per100: Nutrients(kcal: 100, carb: 5.0, protein: 9.0, fat: 5.0),
    packLabel: '450g', packGrams: 450, basePrice: 6500, maxPerMeal: 250,
    dbNames: [],
  ),
  // 아래 단백질은 헬스 유튜브·블로그에서 닭가슴살 다음으로 자주 권하는 것(2026-10 조사).
  PriceItem(
    id: 'tuna_can', name: '참치캔', role: FoodRole.protein,
    per100: Nutrients(kcal: 190, carb: 0, protein: 25.0, fat: 10.0),
    packLabel: '1캔 150g', packGrams: 150, edible: 0.8, basePrice: 2200, maxPerMeal: 150,
    dbNames: ['다랑어, 가다랑어, 통조림, 유지'], pieceGrams: 120, pieceLabel: '캔',
  ),
  PriceItem(
    id: 'pork_ham', name: '돼지 뒷다리살', role: FoodRole.protein,
    per100: Nutrients(kcal: 125, carb: 0, protein: 21.0, fat: 4.5),
    packLabel: '1kg', packGrams: 1000, basePrice: 9000, maxPerMeal: 250,
    dbNames: ['돼지고기, 뒷다리, 생것'],
  ),
  PriceItem(
    id: 'chicken_tender', name: '닭안심', role: FoodRole.protein,
    per100: Nutrients(kcal: 105, carb: 0, protein: 23.0, fat: 1.0),
    packLabel: '1kg', packGrams: 1000, basePrice: 8500, maxPerMeal: 250,
    dbNames: ['닭안심'], group: 'chicken_breast',
  ),
  PriceItem(
    id: 'chicken_thigh', name: '닭다리살', role: FoodRole.protein,
    per100: Nutrients(kcal: 160, carb: 0, protein: 18.0, fat: 9.5),
    packLabel: '정육 1kg', packGrams: 1000, basePrice: 11000, maxPerMeal: 220,
    dbNames: [],
  ),
  PriceItem(
    id: 'beef_round', name: '소 우둔살', role: FoodRole.protein,
    per100: Nutrients(kcal: 130, carb: 0, protein: 21.5, fat: 4.5),
    packLabel: '수입 1kg', packGrams: 1000, basePrice: 22000, maxPerMeal: 200,
    dbNames: ['소고기, 한우(3등급), 우둔(우둔살), 생것'],
  ),
  PriceItem(
    id: 'squid', name: '오징어', role: FoodRole.protein,
    per100: Nutrients(kcal: 87, carb: 1.0, protein: 18.0, fat: 1.2),
    packLabel: '손질 냉동 1kg', packGrams: 1000, basePrice: 14000, maxPerMeal: 250,
    dbNames: ['오징어, 생것'],
  ),
  PriceItem(
    id: 'shrimp', name: '새우살', role: FoodRole.protein,
    per100: Nutrients(kcal: 82, carb: 0.5, protein: 18.5, fat: 0.8),
    packLabel: '냉동 1kg', packGrams: 1000, basePrice: 16000, maxPerMeal: 250,
    dbNames: ['새우살'],
  ),
  PriceItem(
    id: 'salmon', name: '연어', role: FoodRole.protein,
    per100: Nutrients(kcal: 200, carb: 0, protein: 20.0, fat: 13.0),
    packLabel: '냉동 1kg', packGrams: 1000, basePrice: 30000, maxPerMeal: 200,
    dbNames: [],
  ),
  PriceItem(
    id: 'natto', name: '낫토', role: FoodRole.protein,
    per100: Nutrients(kcal: 200, carb: 12.0, protein: 16.5, fat: 10.0),
    packLabel: '50g × 8팩', packGrams: 400, basePrice: 4500, maxPerMeal: 100,
    dbNames: ['낫토'], pieceGrams: 50, pieceLabel: '팩',
  ),
  PriceItem(
    id: 'whey', name: '단백질 보충제', role: FoodRole.protein,
    per100: Nutrients(kcal: 390, carb: 8.0, protein: 75.0, fat: 6.0),
    packLabel: '유청 2kg', packGrams: 2000, basePrice: 37000, maxPerMeal: 60,
    dbNames: [] /* DB 값은 게이너형(단백질 46%)이라 요즘 유청과 달라 기본값 */, pieceGrams: 30, pieceLabel: '스쿱', mealItem: false,
  ),
  PriceItem(
    id: 'rice', name: '쌀', role: FoodRole.carb,
    per100: Nutrients(kcal: 366, carb: 80.4, protein: 6.4, fat: 0.6),
    packLabel: '10kg', packGrams: 10000, basePrice: 32000, maxPerMeal: 120,
    dbNames: ['멥쌀, 백미, 생것'], cooked: 2.3,
  ),
  PriceItem(
    id: 'brown_rice', name: '현미', role: FoodRole.carb,
    per100: Nutrients(kcal: 352, carb: 74.0, protein: 7.6, fat: 2.7),
    packLabel: '4kg', packGrams: 4000, basePrice: 17000, maxPerMeal: 120,
    dbNames: ['멥쌀, 현미, 생것'], cooked: 2.2,
  ),
  PriceItem(
    id: 'sweet_potato', name: '고구마', role: FoodRole.carb,
    per100: Nutrients(kcal: 131, carb: 31.4, protein: 1.4, fat: 0.2),
    packLabel: '1kg', packGrams: 1000, edible: 0.9, basePrice: 5500, maxPerMeal: 400,
    dbNames: ['고구마, 생것'],
  ),
  PriceItem(
    id: 'potato', name: '감자', role: FoodRole.carb,
    per100: Nutrients(kcal: 70, carb: 16.0, protein: 2.0, fat: 0.1),
    packLabel: '1kg', packGrams: 1000, edible: 0.9, basePrice: 4500, maxPerMeal: 400,
    dbNames: ['감자, 수미, 생것'],
  ),
  PriceItem(
    id: 'oats', name: '오트밀', role: FoodRole.carb,
    per100: Nutrients(kcal: 380, carb: 67.0, protein: 13.0, fat: 7.0),
    packLabel: '1kg', packGrams: 1000, basePrice: 9000, maxPerMeal: 100,
    dbNames: ['귀리, 오트밀'],
  ),
  PriceItem(
    id: 'banana', name: '바나나', role: FoodRole.carb,
    per100: Nutrients(kcal: 93, carb: 24.0, protein: 1.1, fat: 0.2),
    packLabel: '1송이 1.2kg', packGrams: 1200, edible: 0.65, basePrice: 4000, maxPerMeal: 240,
    dbNames: ['바나나, 생것'], pieceGrams: 120, pieceLabel: '개',
  ),
  PriceItem(
    id: 'cabbage', name: '양배추', role: FoodRole.veg,
    per100: Nutrients(kcal: 30, carb: 6.5, protein: 1.3, fat: 0.1),
    packLabel: '1통', packGrams: 2500, edible: 0.85, basePrice: 4000,
    dbNames: ['양배추, 생것'],
  ),
  PriceItem(
    id: 'broccoli', name: '브로콜리', role: FoodRole.veg,
    per100: Nutrients(kcal: 33, carb: 5.5, protein: 3.4, fat: 0.3),
    packLabel: '1개', packGrams: 400, edible: 0.7, basePrice: 2500,
    dbNames: ['브로콜리, 생것'],
  ),
  PriceItem(
    id: 'spinach', name: '시금치', role: FoodRole.veg,
    per100: Nutrients(kcal: 30, carb: 4.4, protein: 3.1, fat: 0.5),
    packLabel: '1단 300g', packGrams: 300, edible: 0.9, basePrice: 3000,
    dbNames: ['시금치, 생것'],
  ),
  PriceItem(
    id: 'carrot', name: '당근', role: FoodRole.veg,
    per100: Nutrients(kcal: 37, carb: 8.6, protein: 1.0, fat: 0.2),
    packLabel: '1kg', packGrams: 1000, edible: 0.9, basePrice: 4000,
    dbNames: ['당근, 뿌리, 생것'],
  ),
  PriceItem(
    id: 'cooking_oil', name: '식용유', role: FoodRole.fat,
    per100: Nutrients(kcal: 900, carb: 0, protein: 0, fat: 100),
    packLabel: '콩기름 1.8L', packGrams: 1650, basePrice: 7000, maxPerMeal: 15,
    dbNames: ['콩기름', '식용유'],
  ),
  PriceItem(
    id: 'peanut', name: '땅콩', role: FoodRole.fat,
    per100: Nutrients(kcal: 567, carb: 16.0, protein: 25.8, fat: 49.2),
    packLabel: '볶은땅콩 1kg', packGrams: 1000, basePrice: 12000, maxPerMeal: 30,
    dbNames: ['땅콩, 볶은것'],
  ),
];

PriceItem? priceItemById(String id) {
  for (final i in priceCatalog) {
    if (i.id == id) return i;
  }
  return null;
}

enum PriceSource {
  user('직접 고친 값'),
  kamis('KAMIS 소매가'),
  chamga('참가격'),
  online('쿠팡 판매가'),
  base('참고값');

  const PriceSource(this.label);
  final String label;
}

@immutable
class Price {
  const Price({required this.won, required this.source, this.date, this.region, this.compare});

  /// 파는 단위 하나 값.
  final int won;
  final PriceSource source;

  /// 조사일 'yyyy-MM-dd'.
  final String? date;
  final String? region;

  /// 매장 시세와 온라인 값이 둘 다 있을 때 고르지 않은 쪽(대조용).
  final Price? compare;

  Price withCompare(Price other) => Price(won: won, source: source, date: date, region: region, compare: other);
}

/// 가격 자산의 한 지역.
@immutable
class PriceRegion {
  const PriceRegion({required this.name, required this.lat, required this.lng, required this.prices});

  final String name;
  final double lat, lng;

  /// 품목 id → 값.
  final Map<String, Price> prices;
}

/// 받은 시세 묶음. 지역은 헬스장에서 가장 가까운 곳을 쓴다.
@immutable
class PriceBook {
  const PriceBook({this.regions = const [], this.national = const {}, this.online = const {}});

  static const empty = PriceBook();

  final List<PriceRegion> regions;

  /// 지역 값이 없을 때 쓰는 전국 평균.
  final Map<String, Price> national;

  /// 온라인 판매가(쿠팡 검색 결과 중간값, 전국 하나).
  final Map<String, Price> online;

  PriceRegion? nearest(double? lat, double? lng) {
    if (regions.isEmpty) return null;
    if (lat == null || lng == null) return regions.first;
    double d(PriceRegion r) => _km(lat, lng, r.lat, r.lng);
    return regions.reduce((a, b) => d(a) <= d(b) ? a : b);
  }

  /// 고친 값 > 받은 시세 > 참고값. 받은 시세는 매장(지역 > 전국)과 온라인 중 싼 쪽, 다른 쪽은 [Price.compare].
  Price priceOf(PriceItem item, PriceRegion? region, Map<String, int> overrides) {
    final o = overrides[item.id];
    if (o != null) return Price(won: o, source: PriceSource.user);
    final store = region?.prices[item.id] ?? national[item.id];
    final web = online[item.id];
    if (store != null && web != null) return store.won <= web.won ? store.withCompare(web) : web.withCompare(store);
    return store ?? web ?? Price(won: item.basePrice, source: PriceSource.base);
  }

  static PriceBook fromJson(Map<String, dynamic> j) {
    Map<String, Price> prices(Object? raw, String? region) => {
          for (final e in ((raw as Map?) ?? const {}).entries)
            if (priceItemById(e.key as String) != null)
              e.key as String: Price(
                won: ((e.value as Map)['won'] as num).round(),
                source: PriceSource.values.asNameMap()[(e.value as Map)['source']] ?? PriceSource.kamis,
                date: (e.value as Map)['date'] as String?,
                region: region,
              ),
        };
    return PriceBook(
      regions: [
        for (final r in (j['regions'] as List? ?? const []).cast<Map>())
          PriceRegion(
            name: r['name'] as String,
            lat: (r['lat'] as num).toDouble(),
            lng: (r['lng'] as num).toDouble(),
            prices: prices(r['prices'], r['name'] as String),
          ),
      ],
      national: prices(j['national'], '전국'),
      online: prices(j['online'], null),
    );
  }

  static PriceBook parse(String text) => fromJson((jsonDecode(text) as Map).cast());
}

double _km(double lat1, double lng1, double lat2, double lng2) {
  const r = 6371.0;
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  final a = math.pow(math.sin(dLat / 2), 2) + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * r * math.asin(math.sqrt(a));
}

/// 식단 계산에 쓰는 한 품목: 영양(DB 또는 기본값)과 값.
@immutable
class PricedFood {
  const PricedFood({required this.item, required this.per100, required this.price, required this.fromDb});

  final PriceItem item;
  final Nutrients per100;
  final Price price;
  final bool fromDb;

  /// 먹는 부분 1g 값(원).
  double get wonPerGram => price.won / (item.packGrams * item.edible);
}

List<PricedFood> pricedFoods({
  required PriceBook book,
  required PriceRegion? region,
  required Map<String, int> overrides,
  FoodIndex? index,
}) => [
      for (final item in priceCatalog)
        () {
          Food? f;
          for (final n in item.dbNames) {
            f = index?.exact(n);
            if (f != null) break;
          }
          return PricedFood(
            item: item,
            per100: f?.per100 ?? item.per100,
            price: book.priceOf(item, region, overrides),
            fromDb: f != null,
          );
        }(),
    ];
