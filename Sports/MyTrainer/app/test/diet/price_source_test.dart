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

  test('참가격: 무게를 아는 상품만, 1g 값 중간값을 파는 단위로', () {
    final goods = [
      chamgaGood({'goodId': '1', 'goodName': '하림 닭가슴살 1kg', 'goodTotalCnt': '1', 'goodTotalDivCode': 'kg'}),
      chamgaGood({'goodId': '2', 'goodName': '훈제 닭가슴살 100g', 'goodTotalCnt': '100', 'goodTotalDivCode': 'g'}),
      chamgaGood({'goodId': '3', 'goodName': '풀무원 두부', 'goodTotalCnt': '1', 'goodTotalDivCode': '개'}),
    ].whereType<ChamgaGood>().toList();
    expect(goods.length, 2);
    final matched = chamgaMatch(goods);
    expect(matched['chicken_breast']!.map((g) => g.id), ['1', '2']);
    expect(matched['tofu'], isEmpty);
    final won = chamgaPrice(priceItemById('chicken_breast')!, matched['chicken_breast']!, {
      '1': [9800, 10200],
      '2': [1500],
    });
    // 1g 값: 9.8, 10.2, 15 → 중간 10.2 → 1kg 10,200원
    expect(won, 10200);
  });

  test('주소 → 시세 지역', () {
    expect(regionOfAddress('서울특별시 노원구 공릉로 232'), '서울');
    expect(regionOfAddress('경기도 구리시'), '수원');
    expect(regionOfAddress('경상남도 창원시'), '창원');
    expect(regionOfAddress('Tokyo'), isNull);
  });
}
