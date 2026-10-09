import 'dart:convert';

import 'package:meta/meta.dart';

/// 영상 → 루틴 추출 요청의 단일 기준(앱의 firebase_ai 호출과 PC 평가 스크립트가 같이 쓴다).
///
/// 모델은 Gemini Developer API 백엔드(FirebaseAI.googleAI)여야 유튜브 링크를 받는다.
/// 공개·일부 공개 영상만, 요청 하나에 링크 하나. 영상 파일은 인라인으로 20MB 까지.
const extractModel = 'gemini-2.5-flash';

const extractPrompt = '''
이 운동 영상에서 운동 루틴을 뽑아 JSON 으로 답해 주세요.

규칙:
- 영상에서 말하거나 화면에 나온 것만 적습니다. 추측해서 채우지 않습니다.
- 운동 순서대로 적습니다. 같은 운동을 여러 번 하면 한 줄로 합치고 세트 수를 더합니다.
- name 은 영상에서 부른 이름 그대로(한국어면 한국어), nameEnglish 는 표준 영어 이름입니다.
- equipment 는 barbell, dumbbell, smith, cable, machine, bodyweight 중 하나, 모르면 unknown.
- 세트·횟수·휴식이 나오지 않으면 null. "8~12회"는 repsMin 8, repsMax 12, "10회"는 둘 다 10.
- 무게는 영상에 숫자로 분명히 나온 경우에만 kg 로 적습니다(lb 면 kg 로 바꿔 note 에 원래 값을 남김).
- 워밍업·스트레칭은 빼고 본 운동만 적습니다.
- 운동 루틴이 아닌 영상이면 isRoutine 을 false 로 하고 exercises 는 빈 배열입니다.
''';

/// Gemini responseSchema(REST 형식). firebase_ai Schema 로 바꾼 것과 같은지 테스트한다.
const Map<String, Object> extractSchema = {
  'type': 'OBJECT',
  'properties': {
    'isRoutine': {'type': 'BOOLEAN'},
    'title': {'type': 'STRING', 'nullable': true},
    'exercises': {
      'type': 'ARRAY',
      'items': {
        'type': 'OBJECT',
        'properties': {
          'name': {'type': 'STRING'},
          'nameEnglish': {'type': 'STRING', 'nullable': true},
          'equipment': {
            'type': 'STRING',
            'format': 'enum',
            'enum': ['barbell', 'dumbbell', 'smith', 'cable', 'machine', 'bodyweight', 'unknown'],
          },
          'sets': {'type': 'INTEGER', 'nullable': true},
          'repsMin': {'type': 'INTEGER', 'nullable': true},
          'repsMax': {'type': 'INTEGER', 'nullable': true},
          'restSeconds': {'type': 'INTEGER', 'nullable': true},
          'weightKg': {'type': 'NUMBER', 'nullable': true},
          'note': {'type': 'STRING', 'nullable': true},
        },
        'required': ['name', 'nameEnglish', 'equipment', 'sets', 'repsMin', 'repsMax', 'restSeconds', 'weightKg', 'note'],
      },
    },
  },
  'required': ['isRoutine', 'title', 'exercises'],
};

@immutable
class ExtractedExercise {
  const ExtractedExercise({
    required this.name,
    this.nameEnglish,
    this.equipment = 'unknown',
    this.sets,
    this.repsMin,
    this.repsMax,
    this.restSeconds,
    this.weightKg,
    this.note,
  });

  final String name;
  final String? nameEnglish;
  final String equipment;
  final int? sets, repsMin, repsMax, restSeconds;
  final double? weightKg;
  final String? note;
}

@immutable
class ExtractedRoutine {
  const ExtractedRoutine({required this.isRoutine, required this.title, required this.exercises});

  final bool isRoutine;
  final String? title;
  final List<ExtractedExercise> exercises;
}

class ExtractError implements Exception {
  const ExtractError(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 모델 응답 JSON → [ExtractedRoutine]. 스키마를 어긴 줄은 버리고, 쓸 줄이 없으면 [ExtractError].
ExtractedRoutine parseExtraction(String? text) {
  if (text == null || text.trim().isEmpty) throw const ExtractError('AI 응답이 비었어요');
  Object? j;
  try {
    // 가끔 ```json 블록으로 감싸 온다.
    final cleaned = text.trim().replaceAll(RegExp(r'^```(json)?\s*|\s*```$'), '');
    j = jsonDecode(cleaned);
  } on FormatException {
    throw const ExtractError('AI 응답을 읽지 못했어요');
  }
  if (j is! Map) throw const ExtractError('AI 응답 형식이 달라요');

  int? asInt(Object? v) => v is num && v > 0 ? v.round() : null;
  final items = <ExtractedExercise>[];
  for (final e in (j['exercises'] as List?) ?? const []) {
    if (e is! Map) continue;
    final name = (e['name'] as Object?)?.toString().trim() ?? '';
    if (name.isEmpty) continue;
    var lo = asInt(e['repsMin']), hi = asInt(e['repsMax']);
    if (lo != null && hi != null && lo > hi) (lo, hi) = (hi, lo);
    items.add(ExtractedExercise(
      name: name,
      nameEnglish: (e['nameEnglish'] as Object?)?.toString(),
      equipment: (e['equipment'] as Object?)?.toString() ?? 'unknown',
      sets: asInt(e['sets']),
      repsMin: lo ?? hi,
      repsMax: hi ?? lo,
      restSeconds: asInt(e['restSeconds']),
      weightKg: e['weightKg'] is num && (e['weightKg'] as num) > 0 ? (e['weightKg'] as num).toDouble() : null,
      note: (e['note'] as Object?)?.toString(),
    ));
  }
  final isRoutine = j['isRoutine'] != false && items.isNotEmpty;
  if (!isRoutine) throw const ExtractError('이 영상에서 운동 루틴을 찾지 못했어요');
  return ExtractedRoutine(isRoutine: true, title: (j['title'] as Object?)?.toString(), exercises: items);
}
