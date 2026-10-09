import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../bootstrap/firebase_bootstrap.dart';
import '../data/models.dart';
import '../data/offline_ready.dart';
import 'geofence_service.dart';
import 'location_access.dart';

/// 15분마다(안드로이드 최소 주기) 도는 보완 작업.
///
/// 1. 네이티브 리시버가 쌓아 둔 지오펜스 이벤트를 올린다.
/// 2. 현재 위치로 헬스장 안/밖을 확인해, 지오펜스가 놓친 진입·이탈을 보충한다.
///    (지하라 지오펜스 알림이 안 오는 경우. 판정 규칙은 중복 진입을 무시한다.)
/// 3. 연결돼 있으면 오프라인 준비를 한다(6시간에 한 번).
class BackgroundSync {
  static const taskName = 'mytrainer.sync';
  static const _insideKey = 'mytrainer.wm.inside';

  static Future<void> schedule() async {
    await Workmanager().initialize(callbackDispatcher);
    await Workmanager().registerPeriodicTask(
      taskName,
      taskName,
      frequency: const Duration(minutes: 15),
      existingWorkPolicy: ExistingWorkPolicy.keep,
    );
  }

  /// 한 번 돌리기. 앱이 켜질 때도 부른다.
  static Future<void> runOnce({bool checkLocation = true}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload(); // 다른 isolate 가 쓴 값을 본다.
    final (repo, mode) = await createRepository(prefs);
    final geo = GeofenceService();

    if (checkLocation) {
      final gym = await repo.gym();
      if (gym != null) await _checkInside(prefs, geo, gym);
    }
    try {
      await geo.flush(repo);
    } catch (e) {
      debugPrint('지오펜스 이벤트 업로드 보류: $e');
    }
    if (mode == SyncMode.cloud) {
      await OfflineReadiness(prefs)
          .prepare(offlineParts(repo,
              machines: createMachineRepository(prefs, createPartyRepository(prefs, mode)),
              routines: createRoutineRepository(prefs, mode)));
    }
  }

  static Future<void> _checkInside(SharedPreferences prefs, GeofenceService geo, Gym gym) async {
    try {
      final p = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 20),
      );
      final inside = distanceM(p.latitude, p.longitude, gym.lat, gym.lng) <= gym.radiusM;
      final was = prefs.getBool(_insideKey);
      await prefs.setBool(_insideKey, inside);
      if (was == null || was == inside) return;

      final now = DateTime.now();
      await geo.enqueue(GeofenceEvent(
        id: 'wm-${now.millisecondsSinceEpoch}',
        kind: inside ? GeofenceKind.enter : GeofenceKind.exit,
        at: now,
        mock: p.isMocked,
      ));
    } catch (e) {
      // 권한이 없거나 위치를 못 받으면 이번 회차는 건너뛴다.
      debugPrint('백그라운드 위치 확인 실패: $e');
    }
  }
}

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, _) async {
    WidgetsFlutterBinding.ensureInitialized();
    try {
      await BackgroundSync.runOnce();
    } catch (e) {
      debugPrint('백그라운드 동기화 실패: $e');
    }
    return true;
  });
}
