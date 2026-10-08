import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/machines/machine_repository.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/log/log_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _emptyDir = Directory.systemTemp.createTempSync('mytrainer_test');

void main() {
  late LocalAttendanceRepository repo;
  late SharedPreferences prefs;

  setUp(() async {
    await initializeDateFormatting('ko_KR');
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    repo = LocalAttendanceRepository(prefs);
  });

  Future<void> pump(WidgetTester t) async {
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        machineRepositoryProvider.overrideWithValue(LocalMachineRepository(prefs)),
        // 위젯 테스트에는 path_provider 가 없다. 빈 큐로 대신한다.
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
      ],
      child: const MaterialApp(home: LogScreen()),
    ));
    await t.pumpAndSettle();
  }

  testWidgets('종목 고르기 → 세트 기록 → 다음 세트는 같은 세트 한 번 탭', (t) async {
    await pump(t);
    await t.tap(find.text('종목 고르기'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), '벤치');
    await t.pumpAndSettle();
    await t.tap(find.text('벤치 프레스'));
    await t.pumpAndSettle();

    // 처음이면 바벨 기본 20kg x 10.
    expect(find.text('20 kg'), findsOneWidget);
    await t.tap(find.byIcon(Icons.add).first); // +2.5
    await t.pump();
    expect(find.text('22.5 kg'), findsOneWidget);

    await t.tap(find.text('세트 기록'));
    await t.pumpAndSettle();

    final saved = await repo.sets(since: DateTime(2000));
    expect(saved, hasLength(1));
    expect(saved.single.exerciseId, 'bench_press');
    expect(saved.single.variant.key, 'barbell');
    expect(saved.single.weightKg, 22.5);
    expect(saved.single.taps, 2); // +2.5 한 번 + 저장
    expect(saved.single.entryMs, isNotNull);

    // 미리 채워진 그대로라 이번엔 한 번 탭.
    expect(find.text('같은 세트 기록'), findsOneWidget);
    await t.tap(find.text('같은 세트 기록'));
    await t.pumpAndSettle();
    final again = await repo.sets(since: DateTime(2000));
    expect(again, hasLength(2));
    expect(again.map((s) => s.taps), contains(1));
    expect(again.where((s) => s.taps == 1).single.entryMs, isNull);
  });

  testWidgets('실패 입력: 무너진 회차 앞까지를 해낸 횟수로 저장', (t) async {
    await pump(t);
    await t.tap(find.text('종목 고르기'));
    await t.pumpAndSettle();
    await t.tap(find.text('스쿼트'));
    await t.pumpAndSettle();

    await t.tap(find.text('중간에 실패했어요'));
    await t.pumpAndSettle();
    await t.tap(find.text('8회째'));
    await t.pumpAndSettle();

    final s = (await repo.sets(since: DateTime(2000))).single;
    expect((s.reps, s.failedAtRep), (7, 8));
    expect(find.text('8회째 실패'), findsOneWidget);
  });

  testWidgets('기구를 바꾸면 그 기구 기록으로 미리 채운다', (t) async {
    await pump(t);
    await t.tap(find.text('종목 고르기'));
    await t.pumpAndSettle();
    await t.tap(find.text('스쿼트'));
    await t.pumpAndSettle();
    await t.tap(find.text('세트 기록')); // 바벨 20kg
    await t.pumpAndSettle();

    await t.tap(find.text('스미스'));
    await t.pumpAndSettle();
    expect(find.text('0 kg'), findsOneWidget); // 스미스 기록 없음 → 바벨 무게가 섞이지 않는다
    expect(find.text('세트 기록'), findsOneWidget);
  });
}
