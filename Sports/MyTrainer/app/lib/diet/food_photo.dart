import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:firebase_ai/firebase_ai.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:meta/meta.dart';

import 'nutrients.dart';

/// 음식 사진 → 음식별 이름·양·영양(설계 추가 범위 N1). 영상 루틴과 같은 Firebase AI Logic.
const foodPhotoModel = 'gemini-2.5-flash';

const foodPhotoPrompt = '''
이 사진에 있는 음식을 하나씩 나눠 JSON 으로 답해 주세요.

규칙:
- name 은 한국 식품영양성분 DB 에 있을 법한 일반 이름(예: 쌀밥, 현미밥, 닭가슴살, 삶은 달걀, 김치찌개, 바나나)으로 적습니다. 상표는 포장에 분명히 보일 때만 brand 에 적습니다.
- grams 는 사진에 보이는 양을 그릇·수저·손 크기로 짐작한 g 입니다(음료는 ml 를 g 로 봅니다).
- kcal, carb, protein, fat 은 그 양 전체의 값입니다(100g 기준이 아님).
- confidence 는 음식 이름을 얼마나 확신하는지 0~1 입니다.
- 반찬·소스도 보이면 따로 적습니다. 음식이 아닌 것은 적지 않습니다.
- 음식 사진이 아니면 isFood 를 false 로 하고 items 는 빈 배열입니다.
''';

/// Gemini responseSchema(REST 형식). firebase_ai Schema 로 바꾼 것과 같은지 테스트한다.
const Map<String, Object> foodPhotoSchema = {
  'type': 'OBJECT',
  'properties': {
    'isFood': {'type': 'BOOLEAN'},
    'items': {
      'type': 'ARRAY',
      'items': {
        'type': 'OBJECT',
        'properties': {
          'name': {'type': 'STRING'},
          'brand': {'type': 'STRING', 'nullable': true},
          'grams': {'type': 'NUMBER'},
          'kcal': {'type': 'NUMBER'},
          'carb': {'type': 'NUMBER'},
          'protein': {'type': 'NUMBER'},
          'fat': {'type': 'NUMBER'},
          'confidence': {'type': 'NUMBER'},
        },
        'required': ['name', 'brand', 'grams', 'kcal', 'carb', 'protein', 'fat', 'confidence'],
      },
    },
  },
  'required': ['isFood', 'items'],
};

Schema buildFoodPhotoSchema() => Schema.object(properties: {
      'isFood': Schema.boolean(),
      'items': Schema.array(
        items: Schema.object(properties: {
          'name': Schema.string(),
          'brand': Schema.string(nullable: true),
          'grams': Schema.number(),
          'kcal': Schema.number(),
          'carb': Schema.number(),
          'protein': Schema.number(),
          'fat': Schema.number(),
          'confidence': Schema.number(),
        }),
      ),
    });

/// AI 가 본 음식 하나. 영양은 [grams] 전체 기준.
@immutable
class PhotoFood {
  const PhotoFood({
    required this.name,
    required this.grams,
    required this.nutrients,
    required this.confidence,
    this.brand,
  });

  final String name;
  final String? brand;
  final double grams;
  final Nutrients nutrients;
  final double confidence;
}

class FoodPhotoError implements Exception {
  const FoodPhotoError(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 응답 JSON → 음식 목록. 이름이나 양이 없는 줄은 버리고, 남는 게 없으면 [FoodPhotoError].
List<PhotoFood> parseFoodPhoto(String? text) {
  if (text == null || text.trim().isEmpty) throw const FoodPhotoError('AI 응답이 비었어요');
  Object? j;
  try {
    j = jsonDecode(text.trim().replaceAll(RegExp(r'^```(json)?\s*|\s*```$'), ''));
  } on FormatException {
    throw const FoodPhotoError('AI 응답을 읽지 못했어요');
  }
  if (j is! Map) throw const FoodPhotoError('AI 응답 형식이 달라요');

  double n(Object? v) => v is num && v.isFinite && v > 0 ? v.toDouble() : 0;
  final out = <PhotoFood>[];
  for (final e in (j['items'] as List?) ?? const []) {
    if (e is! Map) continue;
    final name = (e['name'] as Object?)?.toString().trim() ?? '';
    final grams = n(e['grams']);
    if (name.isEmpty || grams <= 0) continue;
    final brand = (e['brand'] as Object?)?.toString().trim();
    out.add(PhotoFood(
      name: name,
      brand: brand == null || brand.isEmpty ? null : brand,
      grams: grams,
      nutrients: Nutrients(kcal: n(e['kcal']), carb: n(e['carb']), protein: n(e['protein']), fat: n(e['fat'])),
      confidence: n(e['confidence']).clamp(0, 1).toDouble(),
    ));
  }
  if (j['isFood'] == false || out.isEmpty) throw const FoodPhotoError('사진에서 음식을 찾지 못했어요');
  return out;
}

abstract class FoodPhotoAnalyzer {
  bool get available;

  Future<List<PhotoFood>> analyze(List<int> jpeg);
}

class UnavailableFoodPhotoAnalyzer implements FoodPhotoAnalyzer {
  @override
  bool get available => false;

  @override
  Future<List<PhotoFood>> analyze(List<int> jpeg) =>
      throw const FoodPhotoError('사진으로 기록하기는 서버에 연결된 상태에서만 돼요');
}

class GeminiFoodPhotoAnalyzer implements FoodPhotoAnalyzer {
  GeminiFoodPhotoAnalyzer()
      : _model = FirebaseAI.googleAI(appCheck: FirebaseAppCheck.instance, auth: FirebaseAuth.instance)
            .generativeModel(
          model: foodPhotoModel,
          generationConfig: GenerationConfig(
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: buildFoodPhotoSchema(),
          ),
        );

  final GenerativeModel _model;

  @override
  bool get available => true;

  @override
  Future<List<PhotoFood>> analyze(List<int> jpeg) async {
    final GenerateContentResponse res;
    try {
      res = await _model.generateContent([
        Content.multi([InlineDataPart('image/jpeg', Uint8List.fromList(jpeg)), TextPart(foodPhotoPrompt)]),
      ]).timeout(const Duration(seconds: 60));
    } on FirebaseAIException catch (e) {
      throw FoodPhotoError('AI 요청이 실패했어요: ${e.message}');
    } on SocketException {
      throw const FoodPhotoError('인터넷에 연결된 상태에서 다시 시도해 주세요');
    }
    return parseFoodPhoto(res.text);
  }
}
