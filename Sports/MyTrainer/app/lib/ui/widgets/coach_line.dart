import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../diet/diet_state.dart';

/// 추천 아래 한 단락. 규칙 근거는 늘 보이고, 연결돼 있으면 AI 설명이 그 위에 붙는다.
class CoachLine extends ConsumerWidget {
  const CoachLine({super.key, required this.facts, required this.reasons});

  /// AI 에 보낼 규칙 결과. 숫자를 바꾸지 않고 설명만 받는다.
  final Map<String, Object?> facts;
  final List<String> reasons;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final coach = ref.watch(coachProvider);
    final text = coach.available ? ref.watch(coachTextProvider(jsonEncode(facts))) : null;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (text?.valueOrNull case final t?) ...[
        Text(t, style: AppText.body.copyWith(color: AppColors.ink)),
        const SizedBox(height: Gap.xs),
      ] else if (text?.isLoading ?? false) ...[
        Text('설명을 받는 중', style: AppText.caption.copyWith(color: AppColors.inkFaint)),
        const SizedBox(height: Gap.xs),
      ],
      for (final r in reasons) Text(r, style: AppText.caption),
    ]);
  }
}
