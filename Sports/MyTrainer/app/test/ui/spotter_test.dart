import 'dart:async';
import 'dart:convert';
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
import 'package:mytrainer/party/party_repository.dart';
import 'package:mytrainer/party/party_state.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/spotter/pose_source.dart';
import 'package:mytrainer/spotter/recordings.dart';
import 'package:mytrainer/spotter/rep_counter.dart';
import 'package:mytrainer/spotter/spot_repository.dart';
import 'package:mytrainer/spotter/spotter_state.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/home/home_screen.dart';
import 'package:mytrainer/ui/spotter/spot_confirm_screen.dart';
import 'package:mytrainer/ui/spotter/spotter_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../fixtures/squat_synth.dart';

final _emptyDir = Directory.systemTemp.createTempSync('mytrainer_test');

class _FakePose implements PoseSource {
  final ctrl = StreamController<PoseFrame>.broadcast();
  bool stopped = false;

  @override
  Future<void> start() async {}

  @override
  Stream<PoseFrame> get frames => ctrl.stream;

  @override
  Widget preview() => const SizedBox.expand();

  @override
  Future<void> stop() {
    stopped = true;
    return Future.value();
  }
}

class _FakeParty implements PartyRepository {
  @override
  bool get available => true;

  @override
  String get me => 'me';

  @override
  Future<String?> partyId() async => 'p1';

  @override
  Future<String> ensureParty() async => 'p1';

  @override
  Future<Party?> party() async => const Party(id: 'p1', name: '우리 헬스장', ownerId: 'me', inviteCode: 'ABCDEFGH');

  @override
  Future<List<Member>> members() async =>
      const [Member(uid: 'me', displayName: '정모'), Member(uid: 'f1', displayName: '민수')];

  @override
  Future<void> join(String code, String displayName) async {}

  @override
  Future<void> setMyName(String name) async {}

  @override
  Future<void> prime() async {}
}

class _FakeSpots implements SpotRepository {
  final sent = <(String, int, Variant)>[];
  final confirmed = <(String, int)>[];
  final rejected = <String>[];
  final incomingCtrl = StreamController<List<PendingSpot>>.broadcast();

  @override
  bool get available => true;

  @override
  Future<void> send({required String lifterId, required String exerciseId, required Variant variant, required int reps}) async =>
      sent.add((lifterId, reps, variant));

  @override
  Stream<List<PendingSpot>> incoming() => incomingCtrl.stream;

  @override
  Future<void> confirm(PendingSpot spot, int reps) async => confirmed.add((spot.id, reps));

  @override
  Future<void> reject(PendingSpot spot) async => rejected.add(spot.id);
}

void main() {
  late SharedPreferences prefs;
  late LocalAttendanceRepository repo;
  late _FakePose pose;
  late _FakeSpots spots;
  late Directory recDir;
  late List<String> notified;

  setUp(() async {
    await initializeDateFormatting('ko_KR');
    SharedPreferences.setMockInitialValues({'mytrainer.phase': 'logging', 'mytrainer.onboarded': true});
    prefs = await SharedPreferences.getInstance();
    repo = LocalAttendanceRepository(prefs);
    spots = _FakeSpots();
    recDir = Directory.systemTemp.createTempSync('spotter_rec');
    notified = [];
  });

  Future<void> pump(WidgetTester t, {String initial = '/spotter'}) async {
    t.view.physicalSize = const Size(1080, 4000);
    addTearDown(t.view.resetPhysicalSize);
    // 앱처럼 홈 위에 쌓는다(마지막 화면을 닫으면 go_router 스택이 비어 버린다).
    final router = GoRouter(initialLocation: '/', routes: [
      GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
      GoRoute(path: '/spotter', builder: (_, __) => const SpotterScreen()),
      GoRoute(path: '/spots/confirm', builder: (_, s) => SpotConfirmScreen(draft: s.extra! as SpotDraft)),
    ]);
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
        machineRepositoryProvider.overrideWithValue(LocalMachineRepository(prefs)),
        partyRepositoryProvider.overrideWithValue(_FakeParty()),
        spotRepositoryProvider.overrideWithValue(spots),
        // 테스트 존 안에서 만들어야 스트림 이벤트·Future 가 가짜 시계로 흐른다.
        poseSourceFactoryProvider.overrideWithValue(() => pose = _FakePose()),
        recordingStoreProvider.overrideWithValue(RecordingStore(baseDir: () async => recDir)),
        spotNotifierProvider.overrideWithValue((id, title, body) async => notified.add(title)),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await t.pumpAndSettle();
    if (initial != '/') {
      router.push(initial);
      await t.pumpAndSettle();
    }
  }

  /// 녹화 파일 쓰기는 실제 IO 라 가짜 시계로는 끝나지 않는다.
  Future<void> realIo(WidgetTester t) async {
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await t.pumpAndSettle();
  }

  Future<void> film(WidgetTester t, int reps) async {
    await t.tap(find.text('시작'));
    await t.pump();
    for (final f in squats(reps: reps, repMs: 1500)) {
      pose.ctrl.add(f);
    }
    await t.pump();
    expect(find.byKey(const Key('rep-count')), findsOneWidget);
    expect((t.widget(find.byKey(const Key('rep-count'))) as Text).data, '$reps');
    await t.tap(find.text('끝'));
    await t.pumpAndSettle();
  }

  testWidgets('친구 스쿼트를 찍어 보내고, 고친 횟수를 정답으로 녹화에 남긴다', (t) async {
    await pump(t);
    await t.tap(find.text('민수'));
    await t.pumpAndSettle();
    await film(t, 5);

    expect(find.text('앱이 센 횟수 5회. 다르면 고쳐 주세요.'), findsOneWidget);
    await t.tap(find.byIcon(Icons.add));
    await t.pumpAndSettle();
    await t.tap(find.text('민수님에게 보내기'));
    await realIo(t);

    expect(spots.sent, [('f1', 6, Variant.barbell)]);
    expect(pose.stopped, isTrue);
    final files = Directory('${recDir.path}/spotter_recordings').listSync();
    final rec = jsonDecode(File(files.single.path).readAsStringSync()) as Map;
    expect((rec['counted'], rec['truth']), (5, 6));
    expect((rec['frames'] as List), isNotEmpty);
  });

  testWidgets('삼각대로 직접 찍으면 확인 화면에서 무게를 넣어 바로 내 기록', (t) async {
    await pump(t);
    await t.tap(find.text('나 (삼각대로 직접)'));
    await t.pumpAndSettle();
    await film(t, 3);
    await t.tap(find.text('스미스'));
    await t.pumpAndSettle();
    await t.tap(find.text('무게 넣고 저장'));
    await realIo(t);

    expect(find.text('직접 찍은 스쿼트'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, '스미스'), findsOneWidget);
    await t.tap(find.text('기록에 저장'));
    await t.pumpAndSettle();

    final s = (await repo.sets(since: DateTime(2000))).single;
    expect((s.exerciseId, s.variant, s.reps, s.spottedBy), ('squat', Variant.smith, 3, null));
    expect(s.spotId, startsWith('self-'));
    expect(spots.sent, isEmpty);
  });

  testWidgets('리프터: 홈에 확인 대기가 뜨고, 무게를 넣어 저장하면 촬영자 인증 기록', (t) async {
    await pump(t, initial: '/');
    final spot = PendingSpot(
      id: 's1',
      spotterId: 'f1',
      lifterId: 'me',
      exerciseId: 'squat',
      variant: Variant.barbell,
      reps: 8,
      createdAt: DateTime.now().subtract(const Duration(hours: 1)),
    );
    spots.incomingCtrl.add(const []);
    await t.pumpAndSettle();
    spots.incomingCtrl.add([spot]);
    await t.pumpAndSettle();

    expect(find.text('민수님이 스쿼트 8회를 찍었어요'), findsWidgets);
    expect(notified, ['민수님이 스쿼트 8회를 찍었어요']); // 앱이 켜져 있으면 알림
    await t.tap(find.text('확인'));
    await t.pumpAndSettle();

    expect(find.text('민수님이 찍었어요'), findsOneWidget);
    // 무게 +2.5 두 번(바벨 기본 20kg → 25kg), 횟수 -1
    await t.tap(find.byIcon(Icons.add).first);
    await t.tap(find.byIcon(Icons.add).first);
    await t.tap(find.byIcon(Icons.remove).last);
    await t.pumpAndSettle();
    await t.tap(find.text('기록에 저장'));
    await t.pumpAndSettle();

    final s = (await repo.sets(since: DateTime(2000))).single;
    expect((s.weightKg, s.reps, s.spotId, s.spottedBy), (25.0, 7, 's1', 'f1'));
    expect(s.at.millisecondsSinceEpoch, spot.createdAt.millisecondsSinceEpoch); // 실제로 든 시각
    expect(spots.confirmed, [('s1', 7)]);
  });

  testWidgets('리프터가 내 세트가 아니라고 하면 거절', (t) async {
    final spot = PendingSpot(
      id: 's2',
      spotterId: 'f1',
      lifterId: 'me',
      exerciseId: 'squat',
      variant: Variant.barbell,
      reps: 5,
      createdAt: DateTime.now(),
    );
    await pump(t, initial: '/');
    spots.incomingCtrl.add([spot]);
    await t.pumpAndSettle();
    await t.tap(find.text('확인'));
    await t.pumpAndSettle();
    await t.tap(find.text('내 세트가 아니에요'));
    await t.pumpAndSettle();
    expect(spots.rejected, ['s2']);
    expect(await repo.sets(since: DateTime(2000)), isEmpty);
  });

  test('만료: 촬영 24시간 뒤부터는 확인할 수 없다', () {
    final at = DateTime(2026, 10, 9, 10);
    final s = PendingSpot(
        id: 'x', spotterId: 'a', lifterId: 'b', exerciseId: 'squat', variant: Variant.barbell, reps: 1, createdAt: at);
    expect(s.isExpired(at.add(const Duration(hours: 23, minutes: 59))), isFalse);
    expect(s.isExpired(at.add(const Duration(hours: 24))), isTrue);
  });
}
