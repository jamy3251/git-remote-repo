import 'dart:convert';
import 'dart:io';

import 'package:firebase_ai/firebase_ai.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// 규칙이 낸 추천을 말로 풀어 주는 부분(설계 추가 범위 N3). 숫자는 규칙이 정하고 AI 는 설명만 한다.
const coachModel = 'gemini-2.5-flash';

const coachPrompt = '''
아래 JSON 은 헬스 앱이 규칙으로 계산한 오늘의 추천입니다. 이 사용자에게 2~3문장의 한국어로 설명해 주세요.

규칙:
- JSON 에 있는 숫자·음식·종목만 씁니다. 숫자를 바꾸거나 새 숫자·새 음식·새 종목을 만들지 않습니다.
- 왜 이렇게 추천했는지(근거)를 먼저, 오늘 신경 쓸 점 하나를 그다음에 말합니다.
- 진단·치료·보충제·약 이야기는 하지 않습니다. 이모지와 느낌표를 쓰지 않습니다.
- 존댓말(해요체)로, 120자 안팎.
''';

abstract class Coach {
  bool get available;

  /// [facts] 는 규칙 결과. 실패하면 null(화면은 규칙 근거를 그대로 보여준다).
  Future<String?> explain(Map<String, Object?> facts);
}

class NoCoach implements Coach {
  @override
  bool get available => false;

  @override
  Future<String?> explain(Map<String, Object?> facts) async => null;
}

class GeminiCoach implements Coach {
  GeminiCoach()
      : _model = FirebaseAI.googleAI(appCheck: FirebaseAppCheck.instance, auth: FirebaseAuth.instance)
            .generativeModel(model: coachModel, generationConfig: GenerationConfig(temperature: 0.3, maxOutputTokens: 400));

  final GenerativeModel _model;

  /// 같은 추천을 다시 열 때 또 부르지 않는다.
  final _cache = <String, String>{};

  @override
  bool get available => true;

  @override
  Future<String?> explain(Map<String, Object?> facts) async {
    final key = jsonEncode(facts);
    if (_cache[key] case final hit?) return hit;
    try {
      final res = await _model
          .generateContent([Content.text('$coachPrompt\n$key')]).timeout(const Duration(seconds: 20));
      final text = res.text?.trim();
      if (text == null || text.isEmpty) return null;
      return _cache[key] = text;
    } on FirebaseAIException {
      return null;
    } on SocketException {
      return null;
    } catch (_) {
      return null; // 시간 초과 등. 설명이 없어도 추천은 그대로 쓴다.
    }
  }
}
