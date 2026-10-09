import 'package:flutter/foundation.dart';

import 'exercises.dart';

/// 세트 한 개.
///
/// 기록 키는 사용자 + 종목 + 기구 변형이다(설계 D14). 실패 세트는 [reps] 에
/// 실제로 해낸 횟수, [failedAtRep] 에 무너진 회차를 적는다(성공이면 null).
@immutable
class WorkoutSet {
  const WorkoutSet({
    required this.id,
    required this.at,
    required this.exerciseId,
    required this.variant,
    required this.weightKg,
    required this.reps,
    this.failedAtRep,
    this.insideFence = false,
    this.taps = 0,
    this.entryMs,
    this.pickMethod,
    this.pickMs,
    this.spotId,
    this.spottedBy,
  });

  final String id;
  final DateTime at;
  final String exerciseId;
  final Variant variant;
  final double weightKg;

  /// 해낸 횟수.
  final int reps;
  final int? failedAtRep;

  /// 헬스장 지오펜스 안에서 기록했는지. 안이면 출석 체크인으로도 쓴다.
  final bool insideFence;

  /// 이 세트를 남기는 데 누른 횟수(저장 포함). 기록 마찰 지표.
  final int taps;

  /// 첫 조작부터 저장까지 걸린 시간. 바로 "같은 세트"를 누르면 null.
  final int? entryMs;

  /// 종목·기구를 고른 뒤 첫 세트에만: 어떻게 골랐는지와 걸린 시간(설계 D15).
  /// list / recent / photo_auto(1위 확인) / photo_top3 / photo_list(사진 실패 후 목록).
  final String? pickMethod;
  final int? pickMs;

  /// 친구가 스포터 모드로 찍어 보낸 것을 확인해 저장한 세트(촬영자 인증). 촬영자 uid.
  /// 삼각대로 직접 찍었으면 spotId 만 'self' 로 시작한다.
  final String? spotId;
  final String? spottedBy;

  bool get failed => failedAtRep != null;

  String get key => '$exerciseId|${variant.key}';

  Map<String, dynamic> toJson() => {
        'id': id,
        'at': at.millisecondsSinceEpoch,
        'exerciseId': exerciseId,
        'variant': variant.key,
        'weightKg': weightKg,
        'reps': reps,
        if (failedAtRep != null) 'failedAtRep': failedAtRep,
        'insideFence': insideFence,
        'taps': taps,
        if (entryMs != null) 'entryMs': entryMs,
        if (pickMethod != null) 'pickMethod': pickMethod,
        if (pickMs != null) 'pickMs': pickMs,
        if (spotId != null) 'spotId': spotId,
        if (spottedBy != null) 'spottedBy': spottedBy,
      };

  factory WorkoutSet.fromJson(Map<String, dynamic> j) => WorkoutSet(
        id: j['id'] as String,
        at: DateTime.fromMillisecondsSinceEpoch((j['at'] as num).toInt()),
        exerciseId: j['exerciseId'] as String,
        variant: Variant.parse(j['variant'] as String),
        weightKg: (j['weightKg'] as num).toDouble(),
        reps: (j['reps'] as num).toInt(),
        failedAtRep: (j['failedAtRep'] as num?)?.toInt(),
        insideFence: j['insideFence'] as bool? ?? false,
        taps: (j['taps'] as num?)?.toInt() ?? 0,
        entryMs: (j['entryMs'] as num?)?.toInt(),
        pickMethod: j['pickMethod'] as String?,
        pickMs: (j['pickMs'] as num?)?.toInt(),
        spotId: j['spotId'] as String?,
        spottedBy: j['spottedBy'] as String?,
      );
}
