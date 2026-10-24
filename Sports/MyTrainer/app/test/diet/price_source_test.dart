import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/diet/price.dart';
import 'package:mytrainer/diet/price_source.dart';

void main() {
  test('단위 → g: 무게 단위는 바로, 개수 단위는 한 개 무게가 있어야', () {
    expect(unitGrams('1kg'), 1000);
    expect(unitGrams('20 kg'), 20000);
    expect(unitGrams('100g'), 100);
    expect(unitGrams('30구', countGrams: 60), 1800);
    expect(unitGrams('1포기'), isNull);
    expect(unitGrams('개당'), isNull);
  });

  test('원 값: 쉼표를 빼고, - 나 빈 값은 없음', () {
    expect(parseWon('7,180'), 7180);
    expect(parseWon('-'), isNull);
    expect(parseWon(''), isNull);
  });

  test('KAMIS: 품목·품종으로 고르고 우리 파는 단위로 환산, 여러 등급이면 중간값', () {
    final rows = <Map<String, dynamic>>[
      {'item_name': '돼지고기', 'kind_name': '앞다리(100g)', 'rank': '', 'unit': '100g', 'dpr1': '1,480'},
      {'item_name': '돼지고기', 'kind_name': '삼겹살(100g)', 'rank': '', 'unit': '100g', 'dpr1': '2,690'},
      {'item_name': '계란', 'kind_name': '특란(30구)', 'rank': '', 'unit': '30구', 'dpr1': '7,320'},
      {'item_name': '계란', 'kind_name': '대란(30구)', 'rank': '', 'unit': '30구', 'dpr1': '6,500'},
      {'item_name': '쌀', 'kind_name': '20kg', 'rank': '상품', 'unit': '20kg', 'dpr1': '62,000'},
      {'item_name': '쌀', 'kind_name': '20kg', 'rank': '중품', 'unit': '20kg', 'dpr1': '58,000'},
      {'item_name': '양배추', 'kind_name': '양배추(1포기)', 'rank': '', 'unit': '1포기', 'dpr1': '-'},
    ];
    int? price(String id) => kamisPrice(rows, priceItemById(id)!, kamisSpecs[id]!);
    expect(price('pork_shoulder'), 1480);
    expect(price('egg'), 7320); // 특란 30구 = 우리 단위 그대로
    expect(price('rice'), 30000); // (62,000+58,000)/2 를 10kg 로
    expect(price('cabbage'), isNull);
  });

  test('KAMIS: unit 칸이 비면 품종 이름 괄호에서 단위를 읽는다', () {
    final rows = <Map<String, dynamic>>[
      {'item_name': '고구마', 'kind_name': '밤(1kg)', 'unit': '', 'dpr1': '5,800'},
    ];
    expect(kamisPrice(rows, priceItemById('sweet_potato')!, kamisSpecs['sweet_potato']!), 5800);
  });

  test('상품명 괄호 안 내용량', () {
    expect(gramsInName('국산콩두부 부침용(380g)'), 380);
    expect(gramsInName('백설 콩기름(1.5L)'), 1500);
    expect(gramsInName('김천 금물쌀(10kg)'), 10000);
    expect(gramsInName('어느 두부(300g*2)'), 600);
    expect(gramsInName('CJ 1등급 깨끗한 계란(10개)', countGrams: 60), 600);
    expect(gramsInName('CJ 1등급 깨끗한 계란(10개)'), isNull);
    expect(gramsInName('두부 한 모'), isNull);
  });

  test('참가격: 이름 조건·정상가만, 1g 값 중간값을 파는 단위로', () {
    Map<String, dynamic> row(String name, int won, {String? sale}) =>
        {'상품명': name, '판매가격': won, '세일여부': sale, '원플러스원': null, '조사일': '2026-09-11'};
    final spec = chamgaSpecs['tofu']!;
    final rows = [
      row('국산콩두부 부침용(380g)', 3800), // 10원/g
      row('행복한콩 찌개두부(300g)', 2400), // 8원/g
      row('행복한콩 찌개두부(300g)', 3600), // 12원/g
      row('행복한콩 찌개두부(300g)', 900, sale: 'Y'), // 세일은 뺀다
      row('아이꼬야 소고기와두부진밥(100g)', 3000), // 두부 요리는 뺀다
    ].map((r) => chamgaRow(r, spec)).whereType<ChamgaRow>().toList();
    expect(rows.length, 3);
    expect(chamgaPrice(priceItemById('tofu')!, rows), 3000); // 10원/g × 300g
  });

  test('참가격: 쌀은 작은 상품(떡볶이·고추장)과 다른 곡물을 거른다', () {
    final spec = chamgaSpecs['rice']!;
    bool ok(String name) => chamgaRow({'상품명': name, '판매가격': 30000}, spec) != null;
    expect(ok('임금님표 이천쌀 특등급(10kg)'), isTrue);
    expect(ok('미정당 쌀 국물떡볶이(401g)'), isFalse);
    expect(ok('해찬들 우리쌀 고추장(1kg)'), isFalse);
    expect(ok('불릴필요없는 현미(2kg)'), isFalse);
  });
}
