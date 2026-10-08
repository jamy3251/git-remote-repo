import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../routines/routine.dart';
import '../../routines/routines_state.dart';
import '../widgets/panel.dart';

/// 내 루틴 목록. 하나를 "오늘 루틴"으로 고르면 기록 화면 위에 순서대로 보인다.
class RoutinesScreen extends ConsumerWidget {
  const RoutinesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(routinesProvider);
    final activeId = ref.watch(activeRoutineIdProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('루틴')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/routines/import'),
        icon: const Icon(Icons.smart_display_outlined),
        label: const Text('영상에서 가져오기'),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('루틴을 불러오지 못했어요\n$e', style: AppText.body)),
        data: (list) => list.isEmpty
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(Gap.xl),
                  child: Text('따라 하고 싶은 운동 영상 링크를 넣으면\n종목·세트·횟수를 루틴으로 옮겨 드려요.',
                      style: AppText.body, textAlign: TextAlign.center),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, 96),
                children: [
                  for (final r in list)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Gap.sm),
                      child: _RoutineCard(routine: r, active: r.id == activeId),
                    ),
                ],
              ),
      ),
    );
  }
}

class _RoutineCard extends ConsumerWidget {
  const _RoutineCard({required this.routine, required this.active});

  final Routine routine;
  final bool active;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Panel(
        color: active ? AppColors.tealSoft : null,
        padding: const EdgeInsets.all(Gap.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(routine.name, style: AppText.section)),
              PopupMenuButton<String>(
                onSelected: (v) {
                  if (v == 'delete') ref.read(routinesProvider.notifier).delete(routine);
                },
                itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('삭제'))],
              ),
            ]),
            for (final i in routine.items)
              Text('${i.exercise?.name ?? i.exerciseId} · ${i.variant.label}  ${i.sets}세트 × ${i.repsLabel}',
                  style: AppText.caption),
            const SizedBox(height: Gap.sm),
            active
                ? OutlinedButton(
                    onPressed: () => ref.read(activeRoutineIdProvider.notifier).set(null),
                    child: const Text('오늘 루틴에서 내리기'),
                  )
                : FilledButton(
                    onPressed: () => ref.read(activeRoutineIdProvider.notifier).set(routine.id),
                    child: const Text('오늘 이 루틴으로'),
                  ),
          ],
        ),
      );
}
