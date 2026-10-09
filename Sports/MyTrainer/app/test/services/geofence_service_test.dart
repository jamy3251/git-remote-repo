import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/data/models.dart';
import 'package:mytrainer/data/repository.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FailingRepo implements AttendanceRepository {
  @override
  Future<void> saveEvents(List<GeofenceEvent> events) async => throw StateError('offline');
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late Directory base;
  late GeofenceService service;
  late LocalAttendanceRepository repo;

  setUp(() async {
    base = Directory.systemTemp.createTempSync('mytrainer_geo');
    service = GeofenceService(baseDir: () async => base);
    SharedPreferences.setMockInitialValues({});
    repo = LocalAttendanceRepository(await SharedPreferences.getInstance());
  });

  tearDown(() => base.deleteSync(recursive: true));

  // 네이티브 리시버가 쓰는 것과 같은 모양의 파일.
  void nativeWrite(String id, String kind, int at) {
    final dir = Directory('${base.path}/${GeofenceService.queueDir}')..createSync(recursive: true);
    File('${dir.path}/$id.json')
        .writeAsStringSync(jsonEncode({'id': id, 'kind': kind, 'at': at, 'mock': false}));
  }

  test('큐를 올리면 저장되고 파일이 지워진다', () async {
    nativeWrite('a', 'enter', 1000);
    nativeWrite('b', 'exit', 2000);
    expect(await service.flush(repo), 2);
    expect(await repo.events(since: DateTime(1970)), hasLength(2));
    expect(await service.flush(repo), 0);
  });

  test('같은 이벤트 id 를 두 번 올려도 한 건이다', () async {
    nativeWrite('dup', 'enter', 1000);
    await service.flush(repo);
    nativeWrite('dup', 'enter', 1000); // 앱이 업로드 직후 죽어 같은 파일이 다시 생긴 경우
    await service.flush(repo);
    expect(await repo.events(since: DateTime(1970)), hasLength(1));
  });

  test('저장이 실패하면 파일이 남아 다음에 다시 올린다', () async {
    nativeWrite('keep', 'dwell', 1000);
    await expectLater(service.flush(_FailingRepo()), throwsStateError);
    expect(await service.flush(repo), 1);
  });

  test('깨진 파일은 지우고 나머지는 올린다', () async {
    nativeWrite('ok', 'enter', 1000);
    File('${base.path}/${GeofenceService.queueDir}/bad.json').writeAsStringSync('{not json');
    expect(await service.flush(repo), 1);
    expect(Directory('${base.path}/${GeofenceService.queueDir}').listSync(), isEmpty);
  });

  test('쓰는 중인 .tmp 파일은 건드리지 않는다', () async {
    final dir = Directory('${base.path}/${GeofenceService.queueDir}')..createSync(recursive: true);
    File('${dir.path}/half.tmp').writeAsStringSync('{"id":"half"');
    expect(await service.flush(repo), 0);
    expect(File('${dir.path}/half.tmp').existsSync(), isTrue);
  });

  test('Dart 에서 넣은 이벤트도 같은 큐로 올라간다', () async {
    await service.enqueue(GeofenceEvent(
        id: 'wm-1', kind: GeofenceKind.exit, at: DateTime.fromMillisecondsSinceEpoch(5000)));
    expect(await service.flush(repo), 1);
  });
}
