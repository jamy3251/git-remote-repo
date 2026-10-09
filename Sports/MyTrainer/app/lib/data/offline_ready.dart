import 'dart:async';

import 'package:shared_preferences/shared_preferences.dart';

import '../machines/machine_repository.dart';
import '../routines/routine_repository.dart';
import 'repository.dart';

/// 오프라인 준비의 한 부분. [prime] 은 서버에서 받아 로컬 캐시를 채운다(오프라인이면 실패).
///
/// "내 기록", "기구"(T7), "루틴"(T9).
/// 남이 쓴 데이터(파티원이 등록한 기구 등)는 이 단계를 거쳐야 지하에서 보인다.
class OfflinePart {
  const OfflinePart(this.label, this.prime);

  final String label;
  final Future<void> Function() prime;
}

/// 기록 미리 채우기는 반년치를 보고(WorkoutController.historyWindow),
/// 출석·자기보고는 지표 계산에 8주면 충분하다(설계 D13).
List<OfflinePart> offlineParts(
  AttendanceRepository repo, {
  MachineRepository? machines,
  RoutineRepository? routines,
  DateTime? now,
}) {
  final t = now ?? DateTime.now();
  return [
    OfflinePart(
      '내 기록',
      () => repo.prime(
        setsSince: t.subtract(const Duration(days: 180)),
        attendanceSince: t.subtract(const Duration(days: 56)),
      ),
    ),
    if (machines != null) OfflinePart('기구', machines.prime),
    if (routines != null) OfflinePart('루틴', routines.prime),
  ];
}

class OfflineStatus {
  const OfflineStatus({
    required this.local,
    required this.readyAt,
    required this.missing,
    required this.pendingUploads,
  });

  /// 이 폰에만 저장하는 모드. 늘 오프라인으로 동작하니 준비할 것이 없다.
  final bool local;

  /// 모든 부분을 마지막으로 다 받은 시각.
  final DateTime? readyAt;

  /// 마지막 시도에서 못 받은 부분.
  final List<String> missing;

  /// 아직 서버에 안 올라간 것(Firestore 쓰기 대기 + 지오펜스 이벤트 파일).
  final int pendingUploads;

  bool isStale(DateTime now) =>
      readyAt != null && now.difference(readyAt!) > OfflineReadiness.staleAfter;

  bool isReady(DateTime now) => local || (readyAt != null && missing.isEmpty && !isStale(now));
}

/// 연결돼 있을 때 오프라인에 필요한 것을 미리 받아 두고, 언제 받았는지 남긴다.
///
/// 앱을 열 때·당겨서 새로고침할 때·WorkManager 15분 작업에서 부른다.
/// 기록은 SharedPreferences 라 백그라운드 isolate 와 같이 본다.
class OfflineReadiness {
  OfflineReadiness(this._prefs, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final SharedPreferences _prefs;
  final DateTime Function() _clock;

  /// 이보다 오래되면 "다시 준비하세요"로 보인다. 파티원이 그사이 기구를 등록했을 수 있다.
  static const staleAfter = Duration(days: 3);

  /// 강제가 아니면 이 간격 안에 다시 받지 않는다(15분 작업마다 서버를 읽지 않으려고).
  static const minInterval = Duration(hours: 6);

  /// 지하에서 연결이 애매하면 서버 읽기가 오래 걸린다. 부분마다 이만큼만 기다린다.
  static const partTimeout = Duration(seconds: 20);

  static const _readyKey = 'mytrainer.offline.readyAt';
  static const _missingKey = 'mytrainer.offline.missing';
  static const _attemptKey = 'mytrainer.offline.attemptAt';

  DateTime? _time(String key) {
    final ms = _prefs.getInt(key);
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms);
  }

  DateTime? get readyAt => _time(_readyKey);

  List<String> get missing => _prefs.getStringList(_missingKey) ?? const [];

  /// 다른 isolate(WorkManager)가 쓴 값을 본다.
  Future<void> reload() => _prefs.reload();

  /// 모든 부분을 받으면 true. 하나라도 실패하면 그 부분을 [missing] 에 남기고
  /// 준비 시각은 그대로 둔다(예전 캐시라도 있는 게 낫다).
  Future<bool> prepare(List<OfflinePart> parts, {bool force = false}) async {
    final now = _clock();
    final last = _time(_attemptKey);
    if (!force &&
        last != null &&
        now.difference(last) < minInterval &&
        missing.isEmpty &&
        readyAt != null) {
      return true;
    }
    await _prefs.setInt(_attemptKey, now.millisecondsSinceEpoch);

    final failed = <String>[];
    for (final p in parts) {
      try {
        await p.prime().timeout(partTimeout);
      } catch (_) {
        failed.add(p.label);
      }
    }
    await _prefs.setStringList(_missingKey, failed);
    if (failed.isNotEmpty) return false;
    await _prefs.setInt(_readyKey, _clock().millisecondsSinceEpoch);
    return true;
  }
}
