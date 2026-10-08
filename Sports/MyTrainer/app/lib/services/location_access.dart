import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

import '../data/models.dart';

/// 위치 권한 상태. 자동 출석은 [always] 일 때만 된다.
enum LocationAccess { always, whileInUse, denied }

/// 위치 권한과 헬스장 중심점 측정.
class LocationAccessService {
  const LocationAccessService();

  Future<LocationAccess> status() async {
    if (await Permission.locationAlways.isGranted) return LocationAccess.always;
    if (await Permission.locationWhenInUse.isGranted) return LocationAccess.whileInUse;
    return LocationAccess.denied;
  }

  /// 앱 사용 중 위치를 먼저 받고, 그다음 '항상 허용'을 요청한다.
  ///
  /// 안드로이드 11부터 '항상 허용'은 앱 안 대화상자로 줄 수 없고 설정 화면으로
  /// 넘어간다. 거부해도 앱은 수동 출석 모드로 계속 쓸 수 있다(설계 D7).
  Future<LocationAccess> request() async {
    final inUse = await Permission.locationWhenInUse.request();
    if (!inUse.isGranted) return LocationAccess.denied;
    final always = await Permission.locationAlways.request();
    return always.isGranted ? LocationAccess.always : LocationAccess.whileInUse;
  }

  Future<bool> openSettings() => openAppSettings();

  /// 헬스장 안에서 [duration] 동안 위치를 받아 평균을 낸다.
  ///
  /// 실내 GPS 는 한 번 찍으면 수십 미터 튄다. 여러 번 받아 정확도로 가중 평균하면
  /// 지오펜스 반경 안에 넉넉히 들어온다. [onProgress] 는 0~1.
  Future<Gym> sampleGymCenter({
    Duration duration = const Duration(seconds: 30),
    void Function(double progress, int samples)? onProgress,
  }) async {
    final samples = <Position>[];
    final started = DateTime.now();
    final sub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.best),
    ).listen((p) {
      samples.add(p);
      final t = DateTime.now().difference(started).inMilliseconds / duration.inMilliseconds;
      onProgress?.call(t.clamp(0, 1).toDouble(), samples.length);
    });
    await Future<void>.delayed(duration);
    await sub.cancel();

    if (samples.isEmpty) {
      samples.add(await Geolocator.getCurrentPosition());
    }
    return averagePositions(samples
        .map((p) => (lat: p.latitude, lng: p.longitude, accuracy: p.accuracy))
        .toList());
  }
}

/// 정확도(m)의 제곱 역수로 가중 평균. 정확도가 0 이하로 오면 1m 로 본다.
Gym averagePositions(List<({double lat, double lng, double accuracy})> samples) {
  var wSum = 0.0, lat = 0.0, lng = 0.0;
  for (final s in samples) {
    final a = s.accuracy <= 0 ? 1.0 : s.accuracy;
    final w = 1 / (a * a);
    wSum += w;
    lat += s.lat * w;
    lng += s.lng * w;
  }
  return Gym(lat: lat / wSum, lng: lng / wSum);
}

/// 두 좌표 사이 거리(m).
double distanceM(double lat1, double lng1, double lat2, double lng2) =>
    Geolocator.distanceBetween(lat1, lng1, lat2, lng2);

/// 지금 헬스장 안인가. 세트 저장을 늦추지 않으려고 마지막으로 알려진 위치만 본다.
///
/// 위치가 없거나 오래됐으면(10분 넘음) false. 이 경우 세트는 기록되지만 출석 체크인으로는
/// 쓰이지 않는다(지오펜스·밤 자기보고가 따로 잡는다).
Future<bool> isInsideGym(Gym? gym) async {
  if (gym == null) return false;
  try {
    final p = await Geolocator.getLastKnownPosition();
    if (p == null) return false;
    if (DateTime.now().difference(p.timestamp) > const Duration(minutes: 10)) return false;
    return distanceM(p.latitude, p.longitude, gym.lat, gym.lng) <= gym.radiusM + p.accuracy;
  } catch (_) {
    return false;
  }
}
