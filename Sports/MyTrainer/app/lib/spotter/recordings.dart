import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'recording.dart';

/// 녹화를 촬영자 폰의 앱 전용 폴더에 남긴다.
class RecordingStore {
  RecordingStore({Future<Directory?> Function()? baseDir}) : _baseDir = baseDir ?? getExternalStorageDirectory;

  final Future<Directory?> Function() _baseDir;

  /// 오래된 것부터 지운다. 녹화 하나가 수백 KB 라 넉넉하다.
  static const keep = 50;

  Future<File?> save(PoseRecording r) async {
    final base = await _baseDir();
    if (base == null) return null;
    final dir = Directory('${base.path}/spotter_recordings')..createSync(recursive: true);
    final stamp = r.at.toIso8601String().replaceAll(':', '').split('.').first;
    final f = File('${dir.path}/squat_$stamp.json');
    await f.writeAsString(jsonEncode(r.toJson()));
    final all = dir.listSync().whereType<File>().where((x) => x.path.endsWith('.json')).toList()
      ..sort((a, b) => a.path.compareTo(b.path));
    for (final old in all.take((all.length - keep).clamp(0, all.length))) {
      old.deleteSync();
    }
    return f;
  }
}
