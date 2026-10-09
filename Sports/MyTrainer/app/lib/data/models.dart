import 'package:flutter/foundation.dart';

/// 헬스장 위치. 등록할 때 30초 동안 받은 위치 샘플의 평균이다.
///
/// 사진 EXIF 는 쓰지 않는다. 앱 카메라 촬영본에는 GPS 가 안 박히고,
/// 안드로이드는 ACCESS_MEDIA_LOCATION 없이 사진 위치를 지운다.
@immutable
class Gym {
  const Gym({
    required this.lat,
    required this.lng,
    this.radiusM = 80,
    this.name = '내 헬스장',
  });

  final double lat;
  final double lng;
  final double radiusM;
  final String name;

  Map<String, dynamic> toJson() =>
      {'lat': lat, 'lng': lng, 'radiusM': radiusM, 'name': name};

  factory Gym.fromJson(Map<String, dynamic> j) => Gym(
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        radiusM: (j['radiusM'] as num?)?.toDouble() ?? 80,
        name: j['name'] as String? ?? '내 헬스장',
      );
}

enum GeofenceKind { enter, dwell, exit }

/// 네이티브 리시버가 받은 지오펜스 이벤트.
///
/// [id] 는 리시버가 만든 고유값이다. 같은 이벤트를 두 번 올려도 한 건으로
/// 남도록 저장소가 이 값을 문서 키로 쓴다.
@immutable
class GeofenceEvent {
  const GeofenceEvent({
    required this.id,
    required this.kind,
    required this.at,
    this.mock = false,
  });

  final String id;
  final GeofenceKind kind;
  final DateTime at;

  /// 모의 위치 앱이 만든 위치였는지. 차단하지 않고 표시만 한다.
  final bool mock;

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.name,
        'at': at.millisecondsSinceEpoch,
        'mock': mock,
      };

  factory GeofenceEvent.fromJson(Map<String, dynamic> j) => GeofenceEvent(
        id: j['id'] as String,
        kind: GeofenceKind.values.byName(j['kind'] as String),
        at: DateTime.fromMillisecondsSinceEpoch((j['at'] as num).toInt()),
        mock: j['mock'] as bool? ?? false,
      );
}

/// 밤에 받는 "오늘 헬스장 갔나요?" 한 번 탭.
///
/// 지오펜스와 독립된 방문 기록이다. 지하라 지오펜스가 놓친 날도 이걸로 잡힌다.
@immutable
class SelfReport {
  const SelfReport({
    required this.day,
    required this.went,
    this.loggedByHand,
    this.actualSets,
    this.handLoggedSets,
  });

  /// 날짜만 의미 있다. [dayKey] 로 비교한다.
  final DateTime day;
  final bool went;

  /// 출석 전용 모드(베이스라인)에서만 묻는다. "오늘 수기로 기록했나요?"
  final bool? loggedByHand;

  /// 주 1회 표본 날에만 묻는다. "오늘 실제로 한 세트 수"(설계 D11, 두 기간 동일).
  final int? actualSets;

  /// 베이스라인 표본 날에만. "그중 수기로 적은 세트 수". 사용 기간에는 앱 기록 수를 쓴다.
  final int? handLoggedSets;

  SelfReport copyWith({bool? went, bool? loggedByHand, int? actualSets, int? handLoggedSets}) =>
      SelfReport(
        day: day,
        went: went ?? this.went,
        loggedByHand: loggedByHand ?? this.loggedByHand,
        actualSets: actualSets ?? this.actualSets,
        handLoggedSets: handLoggedSets ?? this.handLoggedSets,
      );

  Map<String, dynamic> toJson() => {
        'day': dayKey(day),
        'went': went,
        if (loggedByHand != null) 'loggedByHand': loggedByHand,
        if (actualSets != null) 'actualSets': actualSets,
        if (handLoggedSets != null) 'handLoggedSets': handLoggedSets,
      };

  factory SelfReport.fromJson(Map<String, dynamic> j) => SelfReport(
        day: DateTime.parse(j['day'] as String),
        went: j['went'] as bool,
        loggedByHand: j['loggedByHand'] as bool?,
        actualSets: (j['actualSets'] as num?)?.toInt(),
        handLoggedSets: (j['handLoggedSets'] as num?)?.toInt(),
      );
}

/// 앱에 세트를 기록한 시각. 지오펜스 안에서 기록하면 체크인으로도 쓴다.
@immutable
class SetMark {
  const SetMark({required this.at, required this.insideFence});

  final DateTime at;
  final bool insideFence;
}

/// 사람이 직접 누른 체크인. 피드에 '수동'으로 표시된다.
@immutable
class ManualCheckIn {
  const ManualCheckIn({required this.at});
  final DateTime at;
}

/// 'yyyy-MM-dd'. 기기 시간대 기준 날짜 키.
String dayKey(DateTime t) {
  final l = t.toLocal();
  final m = l.month.toString().padLeft(2, '0');
  final d = l.day.toString().padLeft(2, '0');
  return '${l.year}-$m-$d';
}
