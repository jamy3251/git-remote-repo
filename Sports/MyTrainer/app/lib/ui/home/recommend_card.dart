import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../diet/diet_state.dart';
import '../../core/theme.dart';
import '../../recommend/workout_recommender.dart';
import '../../routines/routine.dart';
import '../../routines/routines_state.dart';
import '../widgets/coach_line.dart';
import '../widgets/panel.dart';

String _kg(double v) => v == v.roundToDouble() ? '${v.toInt()}kg' : '${v.toStringAsFixed(1)}kg';

/// 홈의 오늘 추천 운동. "오늘 루틴으로"를 누르면 기록 화면 위에 순서대로 뜬다(T9 루틴 경로).
class RecommendCard extends ConsumerWidget {
  const RecommendCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rec = ref.watch(workoutRecommendationProvider);
    if (rec == null) return const SizedBox.shrink();
    if (rec.isEmpty) {
      return Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PanelLabel('오늘 추천 운동'),
          for (final r in rec.reasons) Text(r, style: AppText.body),
        ]),
      );
    }
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PanelLabel('오늘 추천 운동'),
        Text(rec.groups.join(' · '), style: AppText.title),
        const SizedBox(height: Gap.md),
        for (final i in rec.items)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.sm),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${i.exercise.name} · ${i.variant.label}', style: AppText.bodyStrong)),
                Text(
                  '${i.weightKg == null ? '' : '${_kg(i.weightKg!)}  '}${i.sets}×${i.repsMin == i.repsMax ? i.repsMin : '${i.repsMin}~${i.repsMax}'}',
                  style: AppText.label,
                ),
              ]),
              Text(i.reason, style: AppText.caption),
            ]),
          ),
        const SizedBox(height: Gap.xs),
        CoachLine(
          facts: {
            'kind': 'workout',
            'groups': rec.groups,
            'why': rec.reasons,
            'items': [
              for (final i in rec.items)
                {
                  'name': i.exercise.name,
                  if (i.weightKg != null) 'kg': i.weightKg,
                  'sets': i.sets,
                  'reps': '${i.repsMin}~${i.repsMax}',
                  'rule': i.reason,
                },
            ],
          },
          reasons: rec.reasons,
        ),
        const SizedBox(height: Gap.md),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () => startRecommended(context, ref, rec),
            child: const Text('오늘 루틴으로 기록'),
          ),
        ),
      ]),
    );
  }
}

/// 추천을 루틴으로 저장하고 오늘 루틴으로 고른다. 예전 추천 루틴은 지워 목록이 쌓이지 않게 한다.
Future<void> startRecommended(BuildContext context, WidgetRef ref, WorkoutRecommendation rec) async {
  final routines = ref.read(routinesProvider.notifier);
  for (final old in (await ref.read(routinesProvider.future)).where((r) => r.recommended)) {
    await routines.delete(old);
  }
  final r = Routine(
    id: const Uuid().v4(),
    name: rec.title,
    items: [for (final i in rec.items) i.toRoutineItem()],
    createdAt: ref.read(clockProvider)(),
    recommended: true,
  );
  await routines.save(r);
  await ref.read(activeRoutineIdProvider.notifier).set(r.id);
  if (context.mounted) await context.push('/log');
}
