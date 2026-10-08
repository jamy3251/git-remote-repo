import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../data/models.dart';
import '../data/repository.dart';

/// 네이티브 지오펜스(Kotlin GeofenceRegistrar)와 이벤트 폴더 큐를 다룬다.
///
/// 리시버는 앱이 꺼져 있어도 이벤트를 `filesDir/geofence_events/<id>.json` 으로 적는다.
/// 여기서는 채널 없이 폴더를 직접 읽으므로 WorkManager 백그라운드에서도 돈다.
/// 올린 파일만 지우고, 파일 이름이 이벤트 id 라 다시 올려도 중복이 없다.
class GeofenceService {
  GeofenceService({MethodChannel? channel, Future<Directory> Function()? baseDir})
      : _channel = channel ?? const MethodChannel('mytrainer/geofence'),
        _baseDir = baseDir ?? getApplicationSupportDirectory;

  final MethodChannel _channel;
  final Future<Directory> Function() _baseDir;

  static const queueDir = 'geofence_events';

  /// 앱 화면에서만 부른다(채널은 메인 엔진에만 있다).
  Future<void> register(Gym gym) => _channel.invokeMethod('register', {
        'lat': gym.lat,
        'lng': gym.lng,
        'radius': gym.radiusM,
      });

  Future<void> unregister() => _channel.invokeMethod('unregister');

  Future<Directory> _queue() async =>
      Directory('${(await _baseDir()).path}/$queueDir')..createSync(recursive: true);

  /// Dart 쪽에서 만든 이벤트(WorkManager 위치 확인 등)도 같은 큐에 넣는다.
  Future<void> enqueue(GeofenceEvent event) async {
    final dir = await _queue();
    final tmp = File('${dir.path}/${event.id}.tmp');
    await tmp.writeAsString(jsonEncode(event.toJson()));
    await tmp.rename('${dir.path}/${event.id}.json');
  }

  /// 아직 안 올린 이벤트 파일 수.
  Future<int> queued() async =>
      (await _queue()).listSync().whereType<File>().where((f) => f.path.endsWith('.json')).length;

  /// 쌓인 이벤트를 올린다. 올린 개수를 돌려준다. 저장이 실패하면 파일은 그대로 남는다.
  Future<int> flush(AttendanceRepository repo) async {
    final dir = await _queue();
    final files = dir.listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList();
    if (files.isEmpty) return 0;

    final events = <GeofenceEvent>[];
    final done = <File>[];
    for (final f in files) {
      try {
        events.add(GeofenceEvent.fromJson((jsonDecode(f.readAsStringSync()) as Map).cast()));
        done.add(f);
      } catch (e) {
        // 깨진 파일은 다시 읽어도 깨져 있다. 큐가 막히지 않게 지운다.
        debugPrint('지오펜스 이벤트 파일을 못 읽었어요(${f.path}): $e');
        f.deleteSync();
      }
    }

    await repo.saveEvents(events);
    for (final f in done) {
      if (f.existsSync()) f.deleteSync();
    }
    return events.length;
  }
}
