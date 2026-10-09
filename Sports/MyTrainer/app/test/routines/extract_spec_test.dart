import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/routines/extract_spec.dart';
import 'package:mytrainer/routines/routine_extractor.dart';

void main() {
  test('앱이 보내는 firebase_ai 스키마 = PC 평가가 보내는 스키마(단일 기준)', () {
    expect(jsonDecode(jsonEncode(buildExtractSchema().toJson())), jsonDecode(jsonEncode(extractSchema)));
  });

  test('정상 응답', () {
    final r = parseExtraction(jsonEncode({
      'isRoutine': true,
      'title': '가슴 루틴',
      'exercises': [
        {'name': '벤치프레스', 'nameEnglish': 'Bench Press', 'equipment': 'barbell', 'sets': 4, 'repsMin': 8, 'repsMax': 10, 'restSeconds': 120, 'weightKg': 60, 'note': null},
        {'name': '딥스', 'nameEnglish': 'Dips', 'equipment': 'bodyweight', 'sets': 3, 'repsMin': null, 'repsMax': null, 'restSeconds': null, 'weightKg': null, 'note': null},
      ],
    }));
    expect(r.title, '가슴 루틴');
    expect(r.exercises.map((e) => (e.name, e.sets, e.repsMin, e.repsMax, e.weightKg)).toList(), [
      ('벤치프레스', 4, 8, 10, 60.0),
      ('딥스', 3, null, null, null),
    ]);
  });

  test('코드 블록으로 감싸 와도, 횟수 위아래가 뒤집혀도, 한쪽만 와도 읽는다', () {
    final r = parseExtraction('```json\n${jsonEncode({
      'isRoutine': true,
      'title': null,
      'exercises': [
        {'name': 'a', 'repsMin': 12, 'repsMax': 8},
        {'name': 'b', 'repsMax': 15},
        {'name': '  ', 'sets': 3}, // 이름 없는 줄은 버린다
        {'name': 'c', 'sets': 0, 'weightKg': -5}, // 0·음수는 없는 값
      ],
    })}\n```');
    expect(r.exercises.map((e) => (e.name, e.repsMin, e.repsMax)).toList(), [('a', 8, 12), ('b', 15, 15), ('c', null, null)]);
    expect(r.exercises.last.sets, isNull);
    expect(r.exercises.last.weightKg, isNull);
  });

  test('루틴이 아니거나 비었거나 깨진 응답은 이유와 함께 실패', () {
    expect(() => parseExtraction(null), throwsA(isA<ExtractError>()));
    expect(() => parseExtraction('not json'), throwsA(isA<ExtractError>()));
    expect(() => parseExtraction('[]'), throwsA(isA<ExtractError>()));
    expect(() => parseExtraction(jsonEncode({'isRoutine': false, 'title': '먹방', 'exercises': []})),
        throwsA(predicate((e) => e.toString().contains('찾지 못했어요'))));
    expect(() => parseExtraction(jsonEncode({'isRoutine': true, 'exercises': []})), throwsA(isA<ExtractError>()));
  });

  test('유튜브 주소 꼴 확인', () {
    for (final ok in [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'youtube.com/shorts/abcDEF12345',
      'https://youtu.be/dQw4w9WgXcQ?si=x',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
    ]) {
      expect(isYoutubeUrl(ok), isTrue, reason: ok);
    }
    for (final bad in ['https://instagram.com/reel/x', 'youtube.com', 'https://vimeo.com/123456']) {
      expect(isYoutubeUrl(bad), isFalse, reason: bad);
    }
  });
}
