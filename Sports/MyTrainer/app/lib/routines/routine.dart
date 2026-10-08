import 'package:meta/meta.dart';

import '../data/exercises.dart';

/// 루틴 한 줄: 종목 + 기구 + 세트·횟수·휴식(설계 D10).
@immutable
class RoutineItem {
  const RoutineItem({
    required this.exerciseId,
    required this.variant,
    required this.sets,
    required this.repsMin,
    required this.repsMax,
    this.restSec,
    this.weightKg,
    this.note,
  });

  final String exerciseId;
  final Variant variant;
  final int sets;

  /// "8~12회"면 8과 12, "10회"면 둘 다 10.
  final int repsMin;
  final int repsMax;
  final int? restSec;

  /// 영상에 무게가 분명히 나온 경우만. AI 가 무게를 추천하지 않는다(v1.1).
  final double? weightKg;
  final String? note;

  Exercise? get exercise => exerciseById(exerciseId);

  String get repsLabel => repsMin == repsMax ? '$repsMin회' : '$repsMin~$repsMax회';

  RoutineItem copyWith({String? exerciseId, Variant? variant, int? sets, int? repsMin, int? repsMax}) => RoutineItem(
        exerciseId: exerciseId ?? this.exerciseId,
        variant: variant ?? this.variant,
        sets: sets ?? this.sets,
        repsMin: repsMin ?? this.repsMin,
        repsMax: repsMax ?? this.repsMax,
        restSec: restSec,
        weightKg: weightKg,
        note: note,
      );

  Map<String, dynamic> toJson() => {
        'exerciseId': exerciseId,
        'variant': variant.key,
        'sets': sets,
        'repsMin': repsMin,
        'repsMax': repsMax,
        if (restSec != null) 'restSec': restSec,
        if (weightKg != null) 'weightKg': weightKg,
        if (note != null) 'note': note,
      };

  factory RoutineItem.fromJson(Map<String, dynamic> j) => RoutineItem(
        exerciseId: j['exerciseId'] as String,
        variant: Variant.parse(j['variant'] as String),
        sets: (j['sets'] as num).toInt(),
        repsMin: (j['repsMin'] as num).toInt(),
        repsMax: (j['repsMax'] as num).toInt(),
        restSec: (j['restSec'] as num?)?.toInt(),
        weightKg: (j['weightKg'] as num?)?.toDouble(),
        note: j['note'] as String?,
      );
}

@immutable
class Routine {
  const Routine({
    required this.id,
    required this.name,
    required this.items,
    required this.createdAt,
    this.sourceUrl,
  });

  final String id;
  final String name;
  final List<RoutineItem> items;
  final DateTime createdAt;

  /// 가져온 영상 링크. 영상 본문은 저장하지 않는다.
  final String? sourceUrl;

  Map<String, dynamic> toJson() => {
        'name': name,
        'items': [for (final i in items) i.toJson()],
        'createdAt': createdAt.millisecondsSinceEpoch,
        if (sourceUrl != null) 'sourceUrl': sourceUrl,
      };

  factory Routine.fromJson(String id, Map<String, dynamic> j) => Routine(
        id: id,
        name: j['name'] as String,
        items: [for (final i in j['items'] as List) RoutineItem.fromJson((i as Map).cast())],
        createdAt: DateTime.fromMillisecondsSinceEpoch((j['createdAt'] as num).toInt()),
        sourceUrl: j['sourceUrl'] as String?,
      );
}
