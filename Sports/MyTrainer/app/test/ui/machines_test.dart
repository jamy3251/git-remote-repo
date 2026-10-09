import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/machines/embedder.dart';
import 'package:mytrainer/machines/machine.dart';
import 'package:mytrainer/machines/machine_repository.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/log/log_screen.dart';
import 'package:mytrainer/ui/machines/register_machine_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _emptyDir = Directory.systemTemp.createTempSync('mytrainer_test');

/// 사진 경로 이름 = 벡터. "leg1" 을 찍으면 레그 프레스처럼 보이는 벡터.
const _vectors = <String, List<double>>{
  'leg1': [1, 0, 0],
  'leg2': [0.98, 0.1, 0],
  'leg3': [0.99, 0.05, 0.02],
  'chest1': [0, 1, 0],
  'between': [0.6, 0.6, 0.5], // 어느 기구와도 0.8 미만
};

class _FakeEmbedder implements Embedder {
  @override
  String get modelId => 'test-model';

  @override
  Future<List<double>> embed(String imagePath) async => _vectors[imagePath]!;
}

class _FakeCamera implements PhotoSource {
  final queue = <String?>[];

  @override
  Future<String?> take() async => queue.removeAt(0);
}

void main() {
  late SharedPreferences prefs;
  late LocalAttendanceRepository repo;
  late LocalMachineRepository machines;
  late _FakeCamera camera;

  setUp(() async {
    await initializeDateFormatting('ko_KR');
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    repo = LocalAttendanceRepository(prefs);
    machines = LocalMachineRepository(prefs);
    camera = _FakeCamera();
  });

  Future<void> pump(WidgetTester t, Widget home) async {
    t.view.physicalSize = const Size(1080, 4000);
    addTearDown(t.view.resetPhysicalSize);
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
        machineRepositoryProvider.overrideWithValue(machines),
        embedderProvider.overrideWithValue(_FakeEmbedder()),
        photoSourceProvider.overrideWithValue(camera),
      ],
      child: MaterialApp(home: home),
    ));
    await t.pumpAndSettle();
  }

  Future<void> seed() async {
    Future<void> add(String id, String name, List<String> ex, List<String> shots) => machines.saveMachine(
          Machine(
            id: id,
            name: name,
            kind: MachineKind.machine,
            exerciseIds: ex,
            groupId: id,
            createdBy: 'local',
            createdAt: DateTime(2026),
          ),
          [
            for (final s in shots)
              MachinePhoto(
                id: '$id-$s',
                machineId: id,
                modelId: 'test-model',
                vector: _vectors[s]!,
                createdBy: 'local',
                createdAt: DateTime(2026),
              ),
          ],
        );
    await add('leg', '레그 프레스', ['leg_press', 'calf_raise'], ['leg1', 'leg2']);
    await add('chest', '체스트 프레스', ['chest_press'], ['chest1']);
  }

  group('기구 등록', () {
    testWidgets('사진 2장 + 이름 + 종목 → 등록, 임베딩만 저장', (t) async {
      await pump(t, const RegisterMachineScreen());
      expect(find.text('사진을 2장 이상 찍어 주세요'), findsOneWidget);

      camera.queue.addAll(['leg1', 'leg2']);
      await t.tap(find.text('사진 찍기'));
      await t.pumpAndSettle();
      await t.tap(find.text('한 장 더 찍기'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), '레그 프레스');
      await t.pumpAndSettle();
      await t.tap(find.widgetWithText(FilterChip, '레그 프레스'));
      await t.pumpAndSettle();
      await t.tap(find.text('등록'));
      await t.pumpAndSettle();

      final m = (await machines.machines()).single;
      expect((m.name, m.kind), ('레그 프레스', MachineKind.machine));
      expect(m.exerciseIds, ['leg_press']);
      final ps = await machines.photos();
      expect(ps, hasLength(2));
      expect(ps.every((p) => p.modelId == 'test-model' && p.machineId == m.id && p.dim == 3), isTrue);
    });

    testWidgets('이미 있는 기구와 닮으면 사진 추가를 먼저 권한다', (t) async {
      await seed();
      await pump(t, const RegisterMachineScreen());
      camera.queue.add('leg3');
      await t.tap(find.text('사진 찍기'));
      await t.pumpAndSettle();

      expect(find.text('이미 등록된 "레그 프레스"와(과) 비슷해요'), findsOneWidget);
      await t.tap(find.text('레그 프레스에 사진 추가'));
      await t.pumpAndSettle();

      expect(await machines.machines(), hasLength(2)); // 새 기구 없음
      expect((await machines.photos()).where((p) => p.machineId == 'leg'), hasLength(3));
    });
  });

  group('사진으로 종목 고르기', () {
    Future<void> openPhoto(WidgetTester t, String? shot) async {
      camera.queue.add(shot);
      await t.tap(find.text('기구 사진으로 찾기'));
      await t.pumpAndSettle();
    }

    testWidgets('1위가 확실하면 확인 한 번 → 기구 변형으로 기록, 고르기 방법 남김', (t) async {
      await seed();
      await pump(t, const LogScreen());
      await openPhoto(t, 'leg3');

      expect(find.text('이 기구 맞나요?'), findsOneWidget);
      await t.tap(find.text('레그 프레스 시작'));
      await t.pumpAndSettle();

      // 기구 이름이 변형 칩으로 보인다.
      expect(find.widgetWithText(ChoiceChip, '레그 프레스'), findsOneWidget);
      await t.tap(find.text('세트 기록'));
      await t.pumpAndSettle();

      final s = (await repo.sets(since: DateTime(2000))).single;
      expect((s.exerciseId, s.variant, s.pickMethod), ('leg_press', Variant.machine('leg'), 'photo_auto'));
      expect(s.pickMs, isNotNull);

      // 두 번째 세트에는 고르기 기록이 붙지 않는다.
      await t.tap(find.text('같은 세트 기록'));
      await t.pumpAndSettle();
      final sets = await repo.sets(since: DateTime(2000));
      expect(sets.where((x) => x.pickMethod != null), hasLength(1));
    });

    testWidgets('애매하면 상위 후보 중 고르고, 종목이 여러 개면 바꿀 수 있다', (t) async {
      await seed();
      await pump(t, const LogScreen());
      await openPhoto(t, 'between');

      expect(find.text('어느 기구인가요?'), findsOneWidget);
      await t.tap(find.text('레그 프레스'));
      await t.pumpAndSettle();
      await t.tap(find.text('카프 레이즈'));
      await t.pumpAndSettle();
      await t.tap(find.text('카프 레이즈 시작'));
      await t.pumpAndSettle();
      await t.tap(find.text('세트 기록'));
      await t.pumpAndSettle();

      final s = (await repo.sets(since: DateTime(2000))).single;
      expect((s.exerciseId, s.variant, s.pickMethod), ('calf_raise', Variant.machine('leg'), 'photo_top3'));
    });

    testWidgets('등록된 기구가 없으면 목록으로 넘어가고 photo_list 로 남는다', (t) async {
      await pump(t, const LogScreen());
      await openPhoto(t, 'leg1');
      expect(find.text('등록된 기구가 없어요. 목록에서 고르거나 기구를 등록해 주세요.'), findsOneWidget);

      await t.enterText(find.byType(TextField), '레그 프레스');
      await t.pumpAndSettle();
      await t.tap(find.text('레그 프레스').last);
      await t.pumpAndSettle();
      await t.tap(find.text('세트 기록'));
      await t.pumpAndSettle();
      expect((await repo.sets(since: DateTime(2000))).single.pickMethod, 'photo_list');
    });

    testWidgets('카메라를 취소하면 아무것도 고르지 않는다', (t) async {
      await seed();
      await pump(t, const LogScreen());
      await openPhoto(t, null);
      expect(find.text('어떤 운동부터 할까요?'), findsOneWidget);
    });
  });
}
