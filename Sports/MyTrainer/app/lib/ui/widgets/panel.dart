import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// 흰 바탕 카드 하나. 그림자 대신 얇은 선으로 구분한다.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding, this.color});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: padding ?? const EdgeInsets.all(Gap.xl),
        decoration: BoxDecoration(
          color: color ?? AppColors.surface,
          borderRadius: BorderRadius.circular(Radii.panel),
          border: Border.all(color: AppColors.line),
        ),
        child: child,
      );
}

/// 카드 위 작은 머리말.
class PanelLabel extends StatelessWidget {
  const PanelLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: Gap.sm),
        child: Text(text, style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
      );
}
