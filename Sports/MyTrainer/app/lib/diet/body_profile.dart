import 'package:meta/meta.dart';

import 'nutrients.dart';

enum Sex { male, female }

enum Goal {
  cut('감량'),
  maintain('유지'),
  bulk('증량');

  const Goal(this.label);
  final String label;
}

/// 평소 활동량. 운동하는 날·안 하는 날을 평균 낸 값으로 고른다.
enum Activity {
  sedentary(1.2, '거의 앉아서 지냄', '운동 거의 안 함'),
  light(1.375, '가벼움', '주 1~3회 운동'),
  moderate(1.55, '보통', '주 3~5회 운동'),
  high(1.725, '많음', '주 6~7회 운동 또는 몸 쓰는 일');

  const Activity(this.factor, this.label, this.hint);
  final double factor;
  final String label;
  final String hint;
}

@immutable
class BodyProfile {
  const BodyProfile({
    required this.sex,
    required this.birthYear,
    required this.heightCm,
    required this.weightKg,
    required this.activity,
    required this.goal,
  });

  final Sex sex;
  final int birthYear;
  final double heightCm;
  final double weightKg;
  final Activity activity;
  final Goal goal;

  int ageAt(DateTime now) => now.year - birthYear;

  BodyProfile copyWith({double? weightKg, Goal? goal, Activity? activity}) => BodyProfile(
        sex: sex,
        birthYear: birthYear,
        heightCm: heightCm,
        weightKg: weightKg ?? this.weightKg,
        activity: activity ?? this.activity,
        goal: goal ?? this.goal,
      );

  Map<String, dynamic> toJson() => {
        'sex': sex.name,
        'birthYear': birthYear,
        'heightCm': heightCm,
        'weightKg': weightKg,
        'activity': activity.name,
        'goal': goal.name,
      };

  factory BodyProfile.fromJson(Map<String, dynamic> j) => BodyProfile(
        sex: Sex.values.byName(j['sex'] as String),
        birthYear: (j['birthYear'] as num).toInt(),
        heightCm: (j['heightCm'] as num).toDouble(),
        weightKg: (j['weightKg'] as num).toDouble(),
        activity: Activity.values.byName(j['activity'] as String),
        goal: Goal.values.byName(j['goal'] as String),
      );
}

/// 하루 목표와 그 근거 문장.
@immutable
class DailyTarget {
  const DailyTarget({
    required this.bmr,
    required this.tdee,
    required this.formulaTdee,
    required this.target,
    required this.reasons,
  });

  final double bmr;

  /// 유지 열량. 실측이 있으면 실측.
  final double tdee;

  /// 계산식(BMR×활동 계수) 유지 열량.
  final double formulaTdee;

  bool get measured => tdee != formulaTdee;
  final Nutrients target;
  final List<String> reasons;
}

/// 목표 계산(설계 추가 범위). 계산식은 근거와 같이 화면에 보인다.
///
/// - BMR: Mifflin-St Jeor. 남 10W + 6.25H − 5A + 5, 여 … − 161.
/// - 유지 열량 = BMR × 활동 계수.
/// - 감량 −20%(BMR 아래로는 내리지 않음), 증량 +10%.
/// - 단백질 g/kg: 감량 2.0, 유지 1.6, 증량 1.8. 지방은 열량의 25%. 나머지 탄수화물.
///
/// [measuredTdee] 가 있으면(체중·식단 기록으로 역산, tracking.dart) 활동 계수 대신 그 값을 유지 열량으로 쓴다.
DailyTarget computeTarget(BodyProfile p, DateTime now, {double? measuredTdee}) {
  final age = p.ageAt(now);
  final bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age + (p.sex == Sex.male ? 5 : -161);
  final formula = bmr * p.activity.factor;
  final tdee = measuredTdee ?? formula;

  final reasons = <String>[
    '기초대사량 ${bmr.round()}kcal (키 ${p.heightCm.round()}cm, ${p.weightKg.toStringAsFixed(1)}kg, $age세)',
    if (measuredTdee == null)
      '활동량 "${p.activity.label}" ×${p.activity.factor} → 유지 열량 ${tdee.round()}kcal'
    else
      '유지 열량 ${tdee.round()}kcal: 체중·식단 기록으로 잰 값 (계산식으로는 ${formula.round()}kcal)',
  ];

  double kcal;
  switch (p.goal) {
    case Goal.cut:
      kcal = tdee * 0.8;
      if (kcal < bmr) {
        kcal = bmr;
        reasons.add('감량: 유지 열량의 80%가 기초대사량보다 낮아 기초대사량으로 맞춤');
      } else {
        reasons.add('감량: 유지 열량의 80%');
      }
    case Goal.maintain:
      kcal = tdee;
      reasons.add('유지: 유지 열량 그대로');
    case Goal.bulk:
      kcal = tdee * 1.1;
      reasons.add('증량: 유지 열량의 110%');
  }

  final perKg = switch (p.goal) { Goal.cut => 2.0, Goal.maintain => 1.6, Goal.bulk => 1.8 };
  final protein = p.weightKg * perKg;
  final fat = kcal * 0.25 / 9;
  final carb = ((kcal - protein * 4 - fat * 9) / 4).clamp(0, double.infinity).toDouble();
  reasons.add('단백질 체중 1kg당 ${perKg}g, 지방은 열량의 25%, 나머지 탄수화물');

  return DailyTarget(
    bmr: bmr,
    tdee: tdee,
    formulaTdee: formula,
    target: Nutrients(kcal: kcal, carb: carb, protein: protein, fat: fat),
    reasons: reasons,
  );
}
