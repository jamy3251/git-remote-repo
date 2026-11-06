import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'food.dart';

/// 앱에 넣은 식약처 음식 DB. 만드는 법은 tool/food_db/build_food_db.dart.
const foodDbAsset = 'assets/foods/foods.tsv.gz';

/// 압축 자산 → 검색 색인. 수십만 줄이라 화면이 멈추지 않게 isolate 에서 푼다.
/// 자산이 없으면(아직 DB 를 안 받았으면) 빈 색인.
Future<FoodIndex> loadFoodIndex({AssetBundle? bundle}) async {
  final ByteData data;
  try {
    data = await (bundle ?? rootBundle).load(foodDbAsset);
  } catch (_) {
    return FoodIndex(const []);
  }
  final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  return Isolate.run(() => FoodIndex(const LineSplitter().convert(utf8.decode(gzip.decode(bytes)))));
}

/// 처음 검색할 때 한 번 읽는다. 테스트는 작은 색인으로 덮어쓴다.
final foodIndexProvider = FutureProvider<FoodIndex>((_) => loadFoodIndex());
