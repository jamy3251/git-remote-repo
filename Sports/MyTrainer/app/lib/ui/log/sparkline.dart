import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// 축 없는 작은 추이선. 오래된 값부터. 마지막 점만 강조한다.
class Sparkline extends StatelessWidget {
  const Sparkline({super.key, required this.values});
  final List<double> values;

  @override
  Widget build(BuildContext context) => CustomPaint(painter: _SparkPainter(values), size: Size.infinite);
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values);
  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.length < 2) return;
    final lo = values.reduce((a, b) => a < b ? a : b);
    final hi = values.reduce((a, b) => a > b ? a : b);
    final span = (hi - lo).abs() < 1e-9 ? 1.0 : hi - lo;
    const pad = 4.0;
    Offset at(int i) => Offset(
          pad + (size.width - pad * 2) * i / (values.length - 1),
          pad + (size.height - pad * 2) * (1 - (values[i] - lo) / span),
        );

    final path = Path()..moveTo(at(0).dx, at(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(at(i).dx, at(i).dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = AppColors.teal
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.drawCircle(at(values.length - 1), 3.5, Paint()..color = AppColors.teal);
  }

  @override
  bool shouldRepaint(_SparkPainter old) => old.values != values;
}
