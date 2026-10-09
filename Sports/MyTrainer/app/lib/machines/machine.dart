import 'package:meta/meta.dart';

import '../data/exercises.dart';

/// 기구 종류. 기록 키의 변형을 정한다(설계 D14).
///
/// 핀 머신은 판 무게 표기가 기구마다 달라서 `machine:<그룹ID>` 로 기구까지 나눈다.
/// 스미스·케이블·랙은 어느 기구에서 해도 무게가 같으니 목록 입력과 같은 변형을 쓴다.
enum MachineKind {
  machine('머신', Variant.machineGeneric),
  smith('스미스', Variant.smith),
  cable('케이블', Variant.cable),
  rack('랙·벤치(바벨)', Variant.barbell);

  const MachineKind(this.label, this.catalogVariant);

  final String label;

  /// 카탈로그에서 이 기구로 할 수 있는 종목을 고를 때 보는 변형.
  final Variant catalogVariant;

  static MachineKind parse(String? s) =>
      MachineKind.values.firstWhere((k) => k.name == s, orElse: () => MachineKind.machine);
}

@immutable
class Machine {
  const Machine({
    required this.id,
    required this.name,
    required this.kind,
    required this.exerciseIds,
    required this.groupId,
    required this.createdBy,
    required this.createdAt,
  });

  final String id;
  final String name;
  final MachineKind kind;

  /// 이 기구로 하는 종목. 첫 번째가 처음 쓸 때 기본값.
  final List<String> exerciseIds;

  /// 같은 모델 기구 여러 대를 묶는 ID. 처음엔 자기 id.
  final String groupId;
  final String createdBy;
  final DateTime createdAt;

  /// 이 기구로 기록할 때의 변형.
  Variant get variant => kind == MachineKind.machine ? Variant.machine(groupId) : kind.catalogVariant;

  List<Exercise> get exercises => exerciseIds.map(exerciseById).whereType<Exercise>().toList();

  Machine copyWith({String? name, MachineKind? kind, List<String>? exerciseIds, String? groupId}) =>
      Machine(
        id: id,
        name: name ?? this.name,
        kind: kind ?? this.kind,
        exerciseIds: exerciseIds ?? this.exerciseIds,
        groupId: groupId ?? this.groupId,
        createdBy: createdBy,
        createdAt: createdAt,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'kind': kind.name,
        'exerciseIds': exerciseIds,
        'groupId': groupId,
        'createdBy': createdBy,
        'createdAt': createdAt.millisecondsSinceEpoch,
      };

  factory Machine.fromJson(String id, Map<String, dynamic> j) => Machine(
        id: id,
        name: j['name'] as String,
        kind: MachineKind.parse(j['kind'] as String?),
        exerciseIds: List<String>.from(j['exerciseIds'] as List),
        groupId: j['groupId'] as String? ?? id,
        createdBy: j['createdBy'] as String? ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch((j['createdAt'] as num?)?.toInt() ?? 0),
      );
}

/// 기구 사진 한 장의 임베딩. 사진 자체와 썸네일은 공유하지 않는다(설계 D1).
///
/// [modelId] 가 다른 벡터는 비교하지 않는다(D5). 모델은 공모전 끝까지 고정(D16).
@immutable
class MachinePhoto {
  const MachinePhoto({
    required this.id,
    required this.machineId,
    required this.modelId,
    required this.vector,
    required this.createdBy,
    required this.createdAt,
  });

  final String id;
  final String machineId;
  final String modelId;
  final List<double> vector;
  final String createdBy;
  final DateTime createdAt;

  int get dim => vector.length;

  Map<String, dynamic> toJson() => {
        'modelId': modelId,
        'dim': dim,
        'vector': vector,
        'createdBy': createdBy,
        'createdAt': createdAt.millisecondsSinceEpoch,
      };

  factory MachinePhoto.fromJson(String id, String machineId, Map<String, dynamic> j) => MachinePhoto(
        id: id,
        machineId: machineId,
        modelId: j['modelId'] as String,
        vector: [for (final x in j['vector'] as List) (x as num).toDouble()],
        createdBy: j['createdBy'] as String? ?? '',
        createdAt: DateTime.fromMillisecondsSinceEpoch((j['createdAt'] as num?)?.toInt() ?? 0),
      );
}
