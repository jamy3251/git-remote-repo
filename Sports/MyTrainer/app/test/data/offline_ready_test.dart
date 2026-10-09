import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/offline_ready.dart';
import 'package:mytrainer/data/repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late SharedPreferences prefs;
  late DateTime now;
  late OfflineReadiness ready;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    now = DateTime(2026, 10, 9, 7);
    ready = OfflineReadiness(prefs, clock: () => now);
  });

  OfflinePart ok(String label, List<String> log) => OfflinePart(label, () async => log.add(label));
  OfflinePart fail(String label) => OfflinePart(label, () async => throw StateError('offline'));

  test('모두 받으면 준비 시각을 남긴다', () async {
    final log = <String>[];
    expect(await ready.prepare([ok('내 기록', log), ok('기구', log)]), isTrue);
    expect(log, ['내 기록', '기구']);
    expect(ready.readyAt, now);
    expect(ready.missing, isEmpty);
  });

  test('하나라도 실패하면 그 부분을 남기고 예전 준비 시각은 그대로', () async {
    await ready.prepare([ok('내 기록', [])]);
    final before = ready.readyAt;
    now = now.add(const Duration(days: 1));
    expect(await ready.prepare([ok('내 기록', []), fail('기구')], force: true), isFalse);
    expect(ready.readyAt, before);
    expect(ready.missing, ['기구']);
  });

  test('6시간 안에는 다시 받지 않고, 강제면 받는다', () async {
    final log = <String>[];
    await ready.prepare([ok('a', log)]);
    now = now.add(const Duration(hours: 2));
    await ready.prepare([ok('a', log)]);
    expect(log, hasLength(1));
    await ready.prepare([ok('a', log)], force: true);
    expect(log, hasLength(2));
    now = now.add(const Duration(hours: 7));
    await ready.prepare([ok('a', log)]);
    expect(log, hasLength(3));
  });

  test('지난번에 실패했으면 6시간 안이어도 다시 시도한다', () async {
    await ready.prepare([fail('a')]);
    now = now.add(const Duration(minutes: 15));
    final log = <String>[];
    expect(await ready.prepare([ok('a', log)]), isTrue);
    expect(log, ['a']);
  });

  test('준비 상태: 3일 지나면 오래됨, 이 폰 전용 모드는 늘 준비됨', () {
    final at = DateTime(2026, 10, 1, 9);
    final st = OfflineStatus(local: false, readyAt: at, missing: const [], pendingUploads: 0);
    expect(st.isReady(at.add(const Duration(days: 2))), isTrue);
    expect(st.isReady(at.add(const Duration(days: 4))), isFalse);
    expect(st.isStale(at.add(const Duration(days: 4))), isTrue);

    const never = OfflineStatus(local: false, readyAt: null, missing: [], pendingUploads: 0);
    expect(never.isReady(at), isFalse);
    const local = OfflineStatus(local: true, readyAt: null, missing: [], pendingUploads: 0);
    expect(local.isReady(at), isTrue);
    final partial = OfflineStatus(local: false, readyAt: at, missing: const ['기구'], pendingUploads: 0);
    expect(partial.isReady(at), isFalse);
  });

  test('오프라인 부분 목록: 세트는 반년, 출석은 8주', () async {
    final calls = <(DateTime, DateTime)>[];
    final parts = offlineParts(_Recorder(calls), now: now);
    expect(parts.map((p) => p.label), ['내 기록']);
    await parts.single.prime();
    expect(calls.single, (now.subtract(const Duration(days: 180)), now.subtract(const Duration(days: 56))));
  });
}

class _Recorder extends Fake implements AttendanceRepository {
  _Recorder(this.calls);
  final List<(DateTime, DateTime)> calls;

  @override
  Future<void> prime({required DateTime setsSince, required DateTime attendanceSince}) async =>
      calls.add((setsSince, attendanceSince));
}
