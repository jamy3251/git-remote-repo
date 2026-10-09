import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/routines/exercise_linker.dart';

void main() {
  const linker = ExerciseLinker();

  test('영상에서 흔한 이름들이 맞는 종목·기구로 연결된다', () {
    final cases = <(String, String?, String?, String, Variant)>[
      ('바벨 스쿼트', 'Barbell Back Squat', 'barbell', 'squat', Variant.barbell),
      ('스미스머신 스쿼트', null, null, 'squat', Variant.smith),
      ('덤벨 벤치프레스', 'Dumbbell Bench Press', 'dumbbell', 'bench_press', Variant.dumbbell),
      ('인클라인 덤벨 프레스', 'Incline Dumbbell Press', 'dumbbell', 'incline_bench_press', Variant.dumbbell),
      ('랫풀다운', 'Lat Pulldown', 'cable', 'lat_pulldown', Variant.cable),
      ('사레레', 'Lateral Raise', 'dumbbell', 'lateral_raise', Variant.dumbbell),
      ('RDL', 'Romanian Deadlift', 'barbell', 'romanian_deadlift', Variant.barbell),
      ('리어 델트 플라이', 'Rear Delt Fly', 'machine', 'rear_delt_fly', Variant.machineGeneric),
      ('케이블 크로스오버', 'Cable Crossover', 'cable', 'fly', Variant.cable),
      ('턱걸이', 'Pull-up', 'bodyweight', 'pull_up', Variant.bodyweight),
      ('불가리안 스플릿 스쿼트', 'Bulgarian Split Squat', 'dumbbell', 'lunge', Variant.dumbbell),
      ('해머 컬', 'Hammer Curl', 'dumbbell', 'dumbbell_curl', Variant.dumbbell),
      ('숄더 프레스 머신', 'Machine Shoulder Press', 'machine', 'overhead_press', Variant.machineGeneric),
      ('레그 프레스', 'Leg Press', 'machine', 'leg_press', Variant.machineGeneric),
    ];
    for (final (name, en, eq, id, v) in cases) {
      final r = linker.link(name, nameEnglish: en, equipment: eq);
      expect((r.exercise?.id, r.variant), (id, v), reason: name);
    }
  });

  test('영어 이름만 맞아도 연결한다', () {
    expect(linker.link('스쿼트 투 박스', nameEnglish: 'Box Squat').exercise?.id, 'squat');
  });

  test('기구 힌트가 그 종목에 없으면 종목 기본 기구', () {
    // 데드리프트는 바벨만 있다.
    final r = linker.link('덤벨 데드리프트', equipment: 'dumbbell');
    expect((r.exercise?.id, r.variant), ('deadlift', Variant.barbell));
  });

  test('카탈로그에 없는 운동은 연결하지 않고 후보 3개를 준다', () {
    final r = linker.link('케틀벨 스윙', nameEnglish: 'Kettlebell Swing');
    expect(r.linked, isFalse);
    expect(r.candidates, hasLength(3));
    expect(linker.link('버피', nameEnglish: 'Burpee').linked, isFalse);
  });

  test('정규화: 공백·기호·대소문자 무시', () {
    expect(ExerciseLinker.normalize(' Lat-Pull Down (Wide) '), 'latpulldownwide');
  });
}
