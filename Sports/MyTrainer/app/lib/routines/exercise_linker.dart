import 'package:meta/meta.dart';

import '../data/exercises.dart';

/// 영상 속 운동 이름 → 앱 종목 카탈로그(설계 D10). 확신이 없으면 연결하지 않고 사용자가 고른다.
///
/// 별칭 표가 주력이다. 정확히 같으면 1.0, 별칭이 이름 안에 들어 있으면 0.9(긴 별칭 우선),
/// 그 밖에는 글자 2개 묶음 유사도. [threshold] 미만이면 미연결로 두고 후보 3개를 준다.
const _aliases = <String, List<String>>{
  'squat': ['스쿼트', '백스쿼트', '바벨스쿼트', '하이바스쿼트', '로우바스쿼트', 'squat', 'backsquat', 'highbarsquat'],
  'front_squat': ['프론트스쿼트', '프런트스쿼트', 'frontsquat'],
  'leg_press': ['레그프레스', 'legpress'],
  'lunge': ['런지', '워킹런지', '스플릿스쿼트', '불가리안스플릿스쿼트', 'lunge', 'walkinglunge', 'splitsquat', 'bulgariansplitsquat'],
  'leg_extension': ['레그익스텐션', 'legextension'],
  'leg_curl': ['레그컬', '라잉레그컬', '시티드레그컬', 'legcurl', 'hamstringcurl', 'lyinglegcurl', 'seatedlegcurl'],
  'romanian_deadlift': ['루마니안데드리프트', '루마니안데드', '스티프레그데드리프트', 'rdl', 'romaniandeadlift', 'stiffleggeddeadlift'],
  'hip_thrust': ['힙스러스트', '힙쓰러스트', '글루트브릿지', 'hipthrust', 'glutebridge'],
  'calf_raise': ['카프레이즈', '카프레이스', '종아리', 'calfraise'],
  'deadlift': ['데드리프트', '컨벤셔널데드리프트', '스모데드리프트', 'deadlift', 'conventionaldeadlift', 'sumodeadlift'],
  'pull_up': ['풀업', '턱걸이', '친업', 'pullup', 'chinup'],
  'lat_pulldown': ['랫풀다운', '렛풀다운', '풀다운', 'latpulldown', 'pulldown'],
  'barbell_row': ['바벨로우', '벤트오버로우', '벤트오버바벨로우', '펜들레이로우', 'barbellrow', 'bentoverrow', 'pendlayrow'],
  'dumbbell_row': ['덤벨로우', '원암덤벨로우', '원암로우', 'dumbbellrow', 'onearmdumbbellrow', 'onearmrow'],
  'seated_row': ['시티드로우', '시티드케이블로우', '케이블로우', '로우머신', 'seatedrow', 'seatedcablerow', 'cablerow'],
  'bench_press': ['벤치프레스', '플랫벤치프레스', '플랫벤치', 'benchpress', 'flatbenchpress'],
  'incline_bench_press': ['인클라인벤치프레스', '인클라인벤치', '인클라인프레스', 'inclinebenchpress', 'inclinepress', 'inclinedumbbellpress'],
  'chest_press': ['체스트프레스', 'chestpress'],
  'fly': ['플라이', '펙덱', '펙덱플라이', '케이블크로스오버', '크로스오버', 'fly', 'flye', 'pecdeck', 'cablecrossover', 'chestfly'],
  'dip': ['딥스', '딥', 'dip', 'dips'],
  'push_up': ['푸시업', '푸쉬업', '팔굽혀펴기', 'pushup'],
  'overhead_press': ['오버헤드프레스', '밀리터리프레스', '숄더프레스', 'ohp', 'overheadpress', 'militarypress', 'shoulderpress'],
  'lateral_raise': ['사이드레터럴레이즈', '사이드레터럴', '레터럴레이즈', '사레레', 'lateralraise', 'sidelateralraise'],
  'rear_delt_fly': ['리어델트플라이', '리어델트', '리버스플라이', '리버스펙덱', 'reardeltfly', 'reversefly', 'reversepecdeck'],
  'face_pull': ['페이스풀', 'facepull'],
  'barbell_curl': ['바벨컬', 'barbellcurl', 'ezbarcurl'],
  'dumbbell_curl': ['덤벨컬', '해머컬', '인클라인덤벨컬', 'dumbbellcurl', 'hammercurl', 'bicepcurl', 'bicepscurl'],
  'triceps_pushdown': ['트라이셉스푸시다운', '푸시다운', '푸쉬다운', '케이블푸시다운', 'tricepspushdown', 'pushdown', 'triceppushdown'],
  'skull_crusher': ['스컬크러셔', '라잉트라이셉스익스텐션', 'skullcrusher', 'lyingtricepsextension'],
  'plank': ['플랭크', 'plank'],
  'crunch': ['크런치', '케이블크런치', 'crunch', 'cablecrunch'],
};

/// 이름에서 떼어 내 기구 힌트로 쓰는 말. 앞쪽이 먼저 걸린다.
const _equipmentWords = <String, Variant>{
  '스미스머신': Variant.smith,
  '스미스': Variant.smith,
  'smithmachine': Variant.smith,
  'smith': Variant.smith,
  '바벨': Variant.barbell,
  'barbell': Variant.barbell,
  '덤벨': Variant.dumbbell,
  'dumbbell': Variant.dumbbell,
  '케이블': Variant.cable,
  'cable': Variant.cable,
  '머신': Variant.machineGeneric,
  'machine': Variant.machineGeneric,
  '맨몸': Variant.bodyweight,
  'bodyweight': Variant.bodyweight,
};

const _equipmentField = <String, Variant>{
  'barbell': Variant.barbell,
  'dumbbell': Variant.dumbbell,
  'smith': Variant.smith,
  'cable': Variant.cable,
  'machine': Variant.machineGeneric,
  'bodyweight': Variant.bodyweight,
};

@immutable
class LinkResult {
  const LinkResult({required this.exercise, required this.variant, required this.score, required this.candidates});

  /// 확신이 있으면 연결된 종목, 아니면 null(사용자가 고른다).
  final Exercise? exercise;
  final Variant? variant;
  final double score;

  /// 점수 높은 순 상위 3개.
  final List<Exercise> candidates;

  bool get linked => exercise != null;
}

class ExerciseLinker {
  const ExerciseLinker({this.threshold = 0.75});

  final double threshold;

  static String normalize(String s) => s.toLowerCase().replaceAll(RegExp(r'[\s\-_·.,()/\[\]]'), '');

  LinkResult link(String name, {String? nameEnglish, String? equipment}) {
    var hint = _equipmentField[equipment];
    final names = <String>[];
    for (final raw in [name, if (nameEnglish != null && nameEnglish.isNotEmpty) nameEnglish]) {
      final n = normalize(raw);
      names.add(n);
      // 기구 말을 뗀 이름도 본다("덤벨 벤치프레스" → "벤치프레스" + 덤벨).
      for (final e in _equipmentWords.entries) {
        if (n.contains(e.key)) {
          hint ??= e.value;
          final stripped = n.replaceAll(e.key, '');
          if (stripped.length >= 2) names.add(stripped);
          break;
        }
      }
    }

    final scores = <String, double>{};
    for (final entry in _aliases.entries) {
      var best = 0.0;
      for (final n in names) {
        for (final a in entry.value) {
          final s = n == a
              ? 1.0
              : (a.length >= 3 && n.contains(a))
                  ? 0.9 + 0.005 * a.length.clamp(0, 18) // 더 긴 별칭이 이긴다(인클라인벤치 > 벤치)
                  : _dice(n, a);
          if (s > best) best = s;
        }
      }
      scores[entry.key] = best;
    }
    final ranked = scores.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    final candidates = [for (final e in ranked.take(3)) exerciseById(e.key)!];
    final top = ranked.first;
    final ex = top.value >= threshold ? exerciseById(top.key) : null;
    return LinkResult(
      exercise: ex,
      variant: ex == null ? null : variantFor(ex, hint),
      score: top.value,
      candidates: candidates,
    );
  }

  /// 힌트가 그 종목에 있는 기구면 그것, 아니면 종목 기본 기구.
  static Variant variantFor(Exercise ex, Variant? hint) =>
      hint != null && ex.variants.contains(hint) ? hint : ex.variants.first;

  static double _dice(String a, String b) {
    if (a.length < 2 || b.length < 2) return a == b ? 1 : 0;
    Map<String, int> grams(String s) {
      final m = <String, int>{};
      for (var i = 0; i < s.length - 1; i++) {
        final g = s.substring(i, i + 2);
        m[g] = (m[g] ?? 0) + 1;
      }
      return m;
    }

    final ga = grams(a), gb = grams(b);
    var both = 0;
    for (final e in ga.entries) {
      both += e.value < (gb[e.key] ?? 0) ? e.value : (gb[e.key] ?? 0);
    }
    return 2 * both / (a.length - 1 + b.length - 1);
  }
}
