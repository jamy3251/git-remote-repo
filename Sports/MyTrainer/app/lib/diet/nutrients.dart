import 'package:meta/meta.dart';

/// 열량과 3대 영양소. 단위는 kcal 와 g.
@immutable
class Nutrients {
  const Nutrients({required this.kcal, required this.carb, required this.protein, required this.fat});

  static const zero = Nutrients(kcal: 0, carb: 0, protein: 0, fat: 0);

  final double kcal;
  final double carb;
  final double protein;
  final double fat;

  Nutrients operator +(Nutrients o) =>
      Nutrients(kcal: kcal + o.kcal, carb: carb + o.carb, protein: protein + o.protein, fat: fat + o.fat);

  Nutrients operator -(Nutrients o) =>
      Nutrients(kcal: kcal - o.kcal, carb: carb - o.carb, protein: protein - o.protein, fat: fat - o.fat);

  Nutrients operator *(double k) => Nutrients(kcal: kcal * k, carb: carb * k, protein: protein * k, fat: fat * k);

  /// 음수는 0 으로(다 먹은 영양소는 "남은 양"이 0).
  Nutrients get floorZero => Nutrients(
        kcal: kcal < 0 ? 0 : kcal,
        carb: carb < 0 ? 0 : carb,
        protein: protein < 0 ? 0 : protein,
        fat: fat < 0 ? 0 : fat,
      );

  /// 3대 영양소로 다시 계산한 열량(Atwater 4·4·9). DB 열 매핑 검산에 쓴다.
  double get atwaterKcal => 4 * carb + 4 * protein + 9 * fat;

  Map<String, dynamic> toJson() => {'kcal': kcal, 'carb': carb, 'protein': protein, 'fat': fat};

  factory Nutrients.fromJson(Map<String, dynamic> j) => Nutrients(
        kcal: (j['kcal'] as num).toDouble(),
        carb: (j['carb'] as num).toDouble(),
        protein: (j['protein'] as num).toDouble(),
        fat: (j['fat'] as num).toDouble(),
      );

  @override
  bool operator ==(Object other) =>
      other is Nutrients && other.kcal == kcal && other.carb == carb && other.protein == protein && other.fat == fat;

  @override
  int get hashCode => Object.hash(kcal, carb, protein, fat);

  @override
  String toString() =>
      '${kcal.round()}kcal 탄${carb.toStringAsFixed(1)} 단${protein.toStringAsFixed(1)} 지${fat.toStringAsFixed(1)}';
}
