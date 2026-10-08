import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/machines/machine_repository.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/routines/extract_spec.dart';
import 'package:mytrainer/routines/routine.dart';
import 'package:mytrainer/routines/routine_extractor.dart';
import 'package:mytrainer/routines/routine_repository.dart';
import 'package:mytrainer/routines/routines_state.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/log/log_screen.dart';
import 'package:mytrainer/ui/routines/import_routine_screen.dart';
import 'package:mytrainer/ui/routines/routines_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _emptyDir = Directory.systemTemp.createTempSync('mytrainer_test');

class _FakeExtractor implements RoutineExtractor {
  _FakeExtractor(this.result);
  final ExtractedRoutine result;
  final calls = <VideoInput>[];

  @override
  bool get available => true;

  @override
  Future<ExtractedRoutine> extract(VideoInput input) async {
    calls.add(input);
    return result;
  }
}

const _video = ExtractedRoutine(isRoutine: true, title: '하체 루틴', exercises: [
  ExtractedExercise(name: '바벨 스쿼트', nameEnglish: 'Back Squat', equipment: 'barbell', sets: 5, repsMin: 5, repsMax: 5, weightKg: 60),
  ExtractedExercise(name: '레그 프레스', nameEnglish: 'Leg Press', equipment: 'machine', sets: 3, repsMin: 10, repsMax: 12),
  ExtractedExercise(name: '케틀벨 스윙', nameEnglish: 'Kettlebell Swing', equipment: 'unknown'),
]);

void main() {
  late SharedPreferences prefs;
  late LocalAttendanceRepository repo;
  late LocalRoutineRepository routines;

  setUp(() async {
    await initializeDateFormatting('ko_KR');
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    repo = LocalAttendanceRepository(prefs);
    routines = LocalRoutineRepository(prefs);
  });

  Future<GoRouter> pump(WidgetTester t, String path, {RoutineExtractor? extractor}) async {
    t.view.physicalSize = const Size(1080, 4000);
    addTearDown(t.view.resetPhysicalSize);
    final router = GoRouter(initialLocation: '/', routes: [
      GoRoute(path: '/', builder: (_, __) => const Scaffold(body: Text('home'))),
      GoRoute(path: '/log', builder: (_, __) => const LogScreen()),
      GoRoute(path: '/routines', builder: (_, __) => const RoutinesScreen()),
      GoRoute(path: '/routines/import', builder: (_, __) => const ImportRoutineScreen()),
    ]);
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
        machineRepositoryProvider.overrideWithValue(LocalMachineRepository(prefs)),
        routineRepositoryProvider.overrideWithValue(routines),
        if (extractor != null) routineExtractorProvider.overrideWithValue(extractor),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await t.pumpAndSettle();
    router.push(path);
    await t.pumpAndSettle();
    return router;
  }

  testWidgets('유튜브 링크 → 뽑기 → 못 붙인 종목 직접 고르기 → 저장하면 오늘 루틴', (t) async {
    final ex = _FakeExtractor(_video);
    await pump(t, '/routines/import', extractor: ex);

    await t.enterText(find.byType(TextField), 'https://www.instagram.com/reel/x');
    await t.tap(find.text('루틴 뽑기'));
    await t.pumpAndSettle();
    expect(find.text('유튜브 영상 주소를 넣어 주세요(공개 또는 일부 공개 영상)'), findsOneWidget);
    expect(ex.calls, isEmpty);

    await t.enterText(find.byType(TextField), 'https://youtu.be/dQw4w9WgXcQ');
    await t.tap(find.text('루틴 뽑기'));
    await t.pumpAndSettle();

    expect(find.text('종목 1개를 앱 목록에서 골라 주세요.'), findsOneWidget);
    expect(find.text('스쿼트 · 바벨'), findsOneWidget);
    expect(find.text('레그 프레스 · 머신'), findsOneWidget);
    expect(find.text('영상에 세트·횟수 수가 없어 기본값을 넣었어요'), findsOneWidget); // 케틀벨 스윙
    expect(find.text('종목을 모두 골라 주세요'), findsOneWidget);

    // 카탈로그에 없는 케틀벨 스윙 → 루마니안 데드리프트로 대신.
    await t.tap(find.text('종목 고르기'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField).last, '루마니안');
    await t.pumpAndSettle();
    await t.tap(find.text('루마니안 데드리프트').last);
    await t.pumpAndSettle();
    await t.tap(find.text('저장하고 오늘 루틴으로'));
    await t.pumpAndSettle();

    final saved = (await routines.routines()).single;
    expect(saved.name, '하체 루틴');
    expect(saved.sourceUrl, 'https://youtu.be/dQw4w9WgXcQ');
    expect(saved.items.map((i) => (i.exerciseId, i.variant, i.sets, i.repsMin, i.repsMax, i.weightKg)).toList(), [
      ('squat', Variant.barbell, 5, 5, 5, 60.0),
      ('leg_press', Variant.machineGeneric, 3, 10, 12, null),
      ('romanian_deadlift', Variant.barbell, 3, 10, 10, null),
    ]);
    expect(prefs.getString('mytrainer.routine.active'), saved.id);
  });

  testWidgets('Firebase 가 없으면 가져오기를 막고 이유를 보여준다', (t) async {
    await pump(t, '/routines/import');
    expect(find.text('영상 루틴 가져오기는 서버에 연결된 상태에서만 돼요.'), findsOneWidget);
    expect(t.widget<FilledButton>(find.widgetWithText(FilledButton, '루틴 뽑기')).onPressed, isNull);
  });

  testWidgets('오늘 루틴으로 기록: 무게는 영상 값(내 기록 없을 때), 횟수는 목표 아래쪽, 진행 표시', (t) async {
    final r = Routine(
      id: 'r1',
      name: '하체 루틴',
      createdAt: DateTime(2026, 10, 1),
      items: const [
        RoutineItem(exerciseId: 'squat', variant: Variant.barbell, sets: 3, repsMin: 5, repsMax: 5, weightKg: 60),
        RoutineItem(exerciseId: 'leg_press', variant: Variant.machineGeneric, sets: 3, repsMin: 10, repsMax: 12),
      ],
    );
    await routines.save(r);
    await prefs.setString('mytrainer.routine.active', 'r1');
    await pump(t, '/log');

    expect(find.text('오늘 루틴 · 하체 루틴'), findsOneWidget);
    await t.tap(find.text('스쿼트 0/3'));
    await t.pumpAndSettle();
    expect(find.text('60 kg'), findsOneWidget);
    expect(find.text('5회'), findsOneWidget);

    await t.tap(find.text('세트 기록'));
    await t.pumpAndSettle();
    expect(find.text('스쿼트 1/3'), findsOneWidget);
    final s = (await repo.sets(since: DateTime(2000))).single;
    expect((s.exerciseId, s.weightKg, s.reps, s.pickMethod), ('squat', 60.0, 5, 'routine'));

    // 레그 프레스는 영상 무게가 없고 내 기록도 없으니 기본값, 횟수는 10~12 의 아래쪽.
    await t.tap(find.text('레그 프레스 0/3'));
    await t.pumpAndSettle();
    expect(find.text('10회'), findsOneWidget);
  });

  testWidgets('루틴 목록에서 오늘 루틴을 바꾸고 지운다', (t) async {
    await routines.save(Routine(id: 'a', name: '가슴', createdAt: DateTime(2026, 10, 2), items: const [
      RoutineItem(exerciseId: 'bench_press', variant: Variant.barbell, sets: 4, repsMin: 8, repsMax: 10),
    ]));
    await pump(t, '/routines');
    expect(find.text('벤치 프레스 · 바벨  4세트 × 8~10회'), findsOneWidget);
    await t.tap(find.text('오늘 이 루틴으로'));
    await t.pumpAndSettle();
    expect(prefs.getString('mytrainer.routine.active'), 'a');
    expect(find.text('오늘 루틴에서 내리기'), findsOneWidget);

    await t.tap(find.byType(PopupMenuButton<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('삭제'));
    await t.pumpAndSettle();
    expect(await routines.routines(), isEmpty);
    expect(prefs.getString('mytrainer.routine.active'), isNull);
  });
}
