import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mytrainer/bootstrap/firebase_bootstrap.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/machines/machine_repository.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/data/models.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/home/home_screen.dart';
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

  Future<void> pump(WidgetTester t, {SyncMode mode = SyncMode.local}) async {
    t.view.physicalSize = const Size(1080, 4000);
    addTearDown(t.view.resetPhysicalSize);
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        machineRepositoryProvider.overrideWithValue(LocalMachineRepository(prefs)),
        syncModeProvider.overrideWithValue(mode),
        // 위젯 테스트에는 path_provider 가 없다. 빈 큐로 대신한다.
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
      ],
      child: const MaterialApp(home: HomeScreen()),
    ));
    await t.pumpAndSettle();
  }

  testWidgets('베이스라인: 수동 체크인 → 갔어요 → 이번 주 첫 방문이면 세트 수까지 저장', (t) async {
    await pump(t);
    await t.tap(find.text('지금 헬스장이에요'));
    await t.pumpAndSettle();
    expect(find.text('헬스장에 있어요'), findsOneWidget);
    expect(find.text('수동'), findsOneWidget);

    await t.tap(find.text('갔어요'));
    await t.pumpAndSettle();
    await t.tap(find.text('기록했어요'));
    await t.pumpAndSettle();

    // 이번 주 첫 방문일이라 표본 질문이 나온다.
    expect(find.text('이번 주 확인: 오늘 실제로 몇 세트 했나요?'), findsOneWidget);
    await t.tap(find.text('저장'));
    await t.pumpAndSettle();

    final r = (await repo.reports(since: DateTime(2000))).single;
    expect((r.went, r.loggedByHand, r.actualSets, r.handLoggedSets), (true, true, 15, 0));
    expect(find.text('저장됨 · 다시 저장'), findsOneWidget);
  });

  testWidgets('안 갔어요로 바꾸면 기록·세트 답이 지워진다', (t) async {
    await repo.saveReport(SelfReport(
        day: DateTime.now(), went: true, loggedByHand: true, actualSets: 12, handLoggedSets: 4));
    await pump(t);
    await t.tap(find.text('안 갔어요'));
    await t.pumpAndSettle();
    final r = (await repo.reports(since: DateTime(2000))).single;
    expect((r.went, r.loggedByHand, r.actualSets), (false, null, null));
  });

  testWidgets('사용 기간 모드에서는 운동 기록 버튼이 보이고 수기 질문은 없다', (t) async {
    await prefs.setString('mytrainer.phase', 'logging');
    await repo.saveManual(ManualCheckIn(at: DateTime.now()));
    await pump(t);
    expect(find.text('운동 기록하기'), findsOneWidget);
    await t.tap(find.text('갔어요'));
    await t.pumpAndSettle();
    expect(find.text('오늘 운동을 수기로 기록했나요?'), findsNothing);
  });

  group('오프라인 준비 표시(D13)', () {
    testWidgets('이 폰 전용 모드', (t) async {
      await pump(t);
      expect(find.text('이 폰에만 저장 중'), findsOneWidget);
    });

    testWidgets('서버 모드에서 받기에 성공하면 준비됨 + 올리기 전 개수', (t) async {
      repo = _CloudLike(prefs, online: true, pending: 2);
      await pump(t, mode: SyncMode.cloud);
      expect(find.textContaining('오프라인 준비됨 · '), findsOneWidget);
      expect(find.textContaining('올리기 전 2건'), findsOneWidget);
    });

    testWidgets('연결이 없어 못 받았으면 경고, 연결 후 당기면 준비됨', (t) async {
      final cloud = _CloudLike(prefs, online: false);
      repo = cloud;
      await pump(t, mode: SyncMode.cloud);
      expect(find.textContaining('오프라인 준비 안 됨'), findsOneWidget);

      cloud.online = true;
      await t.fling(find.byType(ListView).first, const Offset(0, 400), 1000);
      await t.pumpAndSettle();
      expect(find.textContaining('오프라인 준비됨 · '), findsOneWidget);
      expect(find.textContaining('오프라인 준비 안 됨'), findsNothing);
    });
  });
}

/// 서버 모드처럼 굴되 저장은 로컬. [online] 이 false 면 받기가 실패한다.
class _CloudLike extends LocalAttendanceRepository {
  _CloudLike(super.prefs, {required this.online, this.pending = 0});

  bool online;
  final int pending;

  @override
  Future<void> prime({required DateTime setsSince, required DateTime attendanceSince}) async {
    if (!online) throw StateError('offline');
  }

  @override
  Future<int> pendingWrites() async => pending;
}
