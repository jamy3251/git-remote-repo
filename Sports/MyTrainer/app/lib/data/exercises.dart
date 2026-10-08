import 'package:meta/meta.dart';

/// 같은 종목이라도 기구가 다르면 무게가 섞이면 안 된다(설계 D14).
///
/// 스미스 스쿼트 60kg 와 바벨 스쿼트 80kg 는 다른 기록이다. 머신은 판 무게 표기가
/// 기구마다 달라서 `machine:<기구그룹ID>` 로 기구까지 구분한다. 기구 매칭(T7)이
/// 붙기 전에는 [Variant.machineGeneric] 을 쓴다.
@immutable
class Variant {
  const Variant._(this.key);

  final String key;

  static const barbell = Variant._('barbell');
  static const dumbbell = Variant._('dumbbell');
  static const smith = Variant._('smith');
  static const cable = Variant._('cable');
  static const bodyweight = Variant._('bodyweight');
  static const machineGeneric = Variant._('machine:generic');

  factory Variant.machine(String groupId) => Variant._('machine:$groupId');

  factory Variant.parse(String key) => Variant._(key);

  bool get isMachine => key.startsWith('machine:');

  String get label => switch (key) {
        'barbell' => '바벨',
        'dumbbell' => '덤벨',
        'smith' => '스미스',
        'cable' => '케이블',
        'bodyweight' => '맨몸',
        'machine:generic' => '머신',
        _ => '머신',
      };

  @override
  bool operator ==(Object other) => other is Variant && other.key == key;

  @override
  int get hashCode => key.hashCode;

  @override
  String toString() => key;
}

@immutable
class Exercise {
  const Exercise(this.id, this.name, this.variants, {this.group = ''});

  final String id;
  final String name;

  /// 고를 수 있는 기구. 첫 번째가 처음 고를 때의 기본값.
  final List<Variant> variants;

  /// 목록에서 묶어 보여줄 부위.
  final String group;
}

const _bb = Variant.barbell;
const _db = Variant.dumbbell;
const _sm = Variant.smith;
const _cb = Variant.cable;
const _bw = Variant.bodyweight;
const _mc = Variant.machineGeneric;

/// 기본 종목 카탈로그. 영상 루틴 복사(T9)의 종목 이름 연결도 이 목록을 기준으로 한다.
const exerciseCatalog = <Exercise>[
  Exercise('squat', '스쿼트', [_bb, _sm, _db], group: '하체'),
  Exercise('front_squat', '프론트 스쿼트', [_bb, _sm], group: '하체'),
  Exercise('leg_press', '레그 프레스', [_mc], group: '하체'),
  Exercise('lunge', '런지', [_db, _bb, _sm, _bw], group: '하체'),
  Exercise('leg_extension', '레그 익스텐션', [_mc], group: '하체'),
  Exercise('leg_curl', '레그 컬', [_mc], group: '하체'),
  Exercise('romanian_deadlift', '루마니안 데드리프트', [_bb, _db], group: '하체'),
  Exercise('hip_thrust', '힙 스러스트', [_bb, _mc], group: '하체'),
  Exercise('calf_raise', '카프 레이즈', [_mc, _sm, _db, _bw], group: '하체'),
  Exercise('deadlift', '데드리프트', [_bb], group: '등'),
  Exercise('pull_up', '풀업', [_bw], group: '등'),
  Exercise('lat_pulldown', '랫 풀다운', [_cb, _mc], group: '등'),
  Exercise('barbell_row', '바벨 로우', [_bb, _sm], group: '등'),
  Exercise('dumbbell_row', '덤벨 로우', [_db], group: '등'),
  Exercise('seated_row', '시티드 로우', [_cb, _mc], group: '등'),
  Exercise('bench_press', '벤치 프레스', [_bb, _db, _sm, _mc], group: '가슴'),
  Exercise('incline_bench_press', '인클라인 벤치 프레스', [_bb, _db, _sm, _mc], group: '가슴'),
  Exercise('chest_press', '체스트 프레스', [_mc], group: '가슴'),
  Exercise('fly', '플라이', [_db, _cb, _mc], group: '가슴'),
  Exercise('dip', '딥스', [_bw, _mc], group: '가슴'),
  Exercise('push_up', '푸시업', [_bw], group: '가슴'),
  Exercise('overhead_press', '오버헤드 프레스', [_bb, _db, _sm, _mc], group: '어깨'),
  Exercise('lateral_raise', '사이드 레터럴 레이즈', [_db, _cb, _mc], group: '어깨'),
  Exercise('rear_delt_fly', '리어 델트 플라이', [_db, _cb, _mc], group: '어깨'),
  Exercise('face_pull', '페이스 풀', [_cb], group: '어깨'),
  Exercise('barbell_curl', '바벨 컬', [_bb], group: '팔'),
  Exercise('dumbbell_curl', '덤벨 컬', [_db, _cb], group: '팔'),
  Exercise('triceps_pushdown', '트라이셉스 푸시다운', [_cb], group: '팔'),
  Exercise('skull_crusher', '라잉 트라이셉스 익스텐션', [_bb, _db], group: '팔'),
  Exercise('plank', '플랭크', [_bw], group: '코어'),
  Exercise('crunch', '크런치', [_bw, _cb, _mc], group: '코어'),
];

Exercise? exerciseById(String id) {
  for (final e in exerciseCatalog) {
    if (e.id == id) return e;
  }
  return null;
}
