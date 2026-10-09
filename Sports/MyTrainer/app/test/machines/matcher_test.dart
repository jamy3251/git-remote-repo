import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/workout.dart';
import 'package:mytrainer/machines/machine.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/machines/matcher.dart';

const model = 'm1';

Machine machine(String id, {MachineKind kind = MachineKind.machine, List<String> ex = const ['leg_press']}) =>
    Machine(
      id: id,
      name: id,
      kind: kind,
      exerciseIds: ex,
      groupId: 'g-$id',
      createdBy: 'me',
      createdAt: DateTime(2026),
    );

MachinePhoto photo(String machineId, List<double> v, {String modelId = model}) => MachinePhoto(
      id: '$machineId-${v.join()}-$modelId',
      machineId: machineId,
      modelId: modelId,
      vector: v,
      createdBy: 'me',
      createdAt: DateTime(2026),
    );

void main() {
  const matcher = MachineMatcher(modelId: model, autoThreshold: 0.9, duplicateThreshold: 0.95);
  final a = machine('a'), b = machine('b'), c = machine('c'), d = machine('d');

  test('기구 점수는 그 기구 사진들 중 최대 유사도, 높은 순', () {
    final r = matcher.match([1, 0, 0], [a, b], [
      photo('a', [0, 1, 0]),
      photo('a', [1, 0.1, 0]), // 거의 같음
      photo('b', [1, 1, 0]), // 0.707
    ]);
    expect(r.ranked.map((s) => s.machine.id), ['a', 'b']);
    expect(r.ranked.first.score, closeTo(0.995, 0.001));
    expect(r.auto?.id, 'a');
  });

  test('1위가 임계값 미만이면 자동 선택 없이 상위 3개', () {
    final r = matcher.match([1, 0, 0], [a, b, c, d], [
      photo('a', [1, 1, 0]),
      photo('b', [1, 0.8, 0]),
      photo('c', [1, 1.2, 0]),
      photo('d', [0, 0, 1]),
    ]);
    expect(r.auto, isNull);
    expect(r.top3.map((s) => s.machine.id), ['b', 'a', 'c']);
  });

  test('model_id 가 다른 벡터는 비교하지 않고 개수만 센다(D5)', () {
    final r = matcher.match([1, 0, 0], [a, b], [
      photo('a', [1, 0, 0], modelId: 'old'),
      photo('b', [0.5, 0.5, 0]),
    ]);
    expect(r.ranked.map((s) => s.machine.id), ['b']);
    expect(r.otherModel, 1);
    expect(r.auto, isNull);
  });

  test('차원이 다른 벡터도 건너뛴다', () {
    final r = matcher.match([1, 0, 0], [a], [photo('a', [1, 0])]);
    expect(r.ranked, isEmpty);
    expect(r.otherModel, 1);
  });

  test('벡터 크기와 무관(정규화 후 비교)', () {
    final r = matcher.match([10, 0, 0], [a], [photo('a', [0.2, 0, 0])]);
    expect(r.ranked.single.score, closeTo(1, 1e-9));
  });

  test('중복 검사: 등록 중 사진 중 하나라도 기존 기구와 아주 닮으면 그 기구', () {
    final photos = [photo('a', [1, 0, 0])];
    expect(matcher.duplicateOf([[0, 1, 0], [1, 0.05, 0]], [a], photos)?.machine.id, 'a');
    expect(matcher.duplicateOf([[1, 0.5, 0]], [a], photos), isNull); // 0.89 < 0.95
    expect(matcher.duplicateOf([[1, 0, 0]], [], const []), isNull);
  });

  test('기구 종류별 기록 변형: 머신은 그룹까지, 스미스·케이블·랙은 공통 변형(D14)', () {
    expect(machine('x').variant, Variant.machine('g-x'));
    expect(machine('x', kind: MachineKind.smith).variant, Variant.smith);
    expect(machine('x', kind: MachineKind.cable).variant, Variant.cable);
    expect(machine('x', kind: MachineKind.rack).variant, Variant.barbell);
  });

  test('기구의 기본 종목: 그 기구로 마지막에 한 종목, 없으면 첫 종목', () {
    final smith = machine('s', kind: MachineKind.smith, ex: ['squat', 'bench_press']);
    expect(defaultExerciseFor(smith, const [])?.id, 'squat');
    WorkoutSet set(String ex, Variant v, int day) => WorkoutSet(
        id: '$ex$day', at: DateTime(2026, 10, day), exerciseId: ex, variant: v, weightKg: 40, reps: 8);
    final history = [
      set('bench_press', Variant.smith, 2),
      set('squat', Variant.barbell, 3), // 바벨이라 이 기구 기록 아님
      set('squat', Variant.smith, 1),
    ];
    expect(defaultExerciseFor(smith, history)?.id, 'bench_press');
  });

  test('등록할 때 고를 수 있는 종목은 기구 종류로 할 수 있는 것만', () {
    expect(exercisesFor(MachineKind.machine).map((e) => e.id), contains('leg_press'));
    expect(exercisesFor(MachineKind.machine).map((e) => e.id), isNot(contains('deadlift')));
    expect(exercisesFor(MachineKind.smith).map((e) => e.id), contains('squat'));
  });
}
