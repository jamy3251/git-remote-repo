import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../machines/machine.dart';
import '../../machines/machines_state.dart';
import '../widgets/panel.dart';

/// 등록된 기구 목록. 파티원이 등록한 것도 보인다.
class MachinesScreen extends ConsumerWidget {
  const MachinesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(machinesProvider);
    final modelId = ref.watch(embedderProvider).modelId;

    return Scaffold(
      appBar: AppBar(title: const Text('기구')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/machines/new'),
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text('기구 등록'),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('기구를 불러오지 못했어요\n$e', style: AppText.body)),
        data: (s) => s.machines.isEmpty
            ? const Padding(
                padding: EdgeInsets.all(Gap.xl),
                child: Center(
                  child: Text(
                    '아직 등록된 기구가 없어요.\n자주 쓰는 머신부터 사진 2~3장으로 등록하면\n다음부터 사진 한 장으로 종목이 골라져요.',
                    style: AppText.body,
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, 96),
                children: [
                  for (final m in [...s.machines]..sort((a, b) => a.name.compareTo(b.name)))
                    Padding(
                      padding: const EdgeInsets.only(bottom: Gap.sm),
                      child: _MachineCard(
                        machine: m,
                        photos: s.photoCount(m.id),
                        needsRephoto: s.needsRephoto(m.id, modelId),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _MachineCard extends ConsumerWidget {
  const _MachineCard({required this.machine, required this.photos, required this.needsRephoto});

  final Machine machine;
  final int photos;
  final bool needsRephoto;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Panel(
        padding: const EdgeInsets.all(Gap.lg),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(machine.name, style: AppText.section),
                  const SizedBox(height: Gap.xs),
                  Text(
                    '${machine.kind.label} · ${machine.exercises.map((e) => e.name).join(', ')}',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: Gap.xs),
                  Text(
                    needsRephoto ? '사진 다시 찍기 필요' : '사진 $photos장',
                    style: AppText.micro.copyWith(
                      color: needsRephoto ? AppColors.coral : AppColors.inkFaint,
                    ),
                  ),
                ],
              ),
            ),
            PopupMenuButton<String>(
              onSelected: (v) async {
                if (v == 'delete') await _delete(context, ref);
              },
              itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('삭제'))],
            ),
          ],
        ),
      );

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    if (!await ref.read(machineRepositoryProvider).canManage(machine)) {
      messenger.showSnackBar(const SnackBar(content: Text('등록한 사람이나 파티장만 지울 수 있어요')));
      return;
    }
    if (!context.mounted) return;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(Gap.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${machine.name}을(를) 지울까요?', style: AppText.title),
            const SizedBox(height: Gap.xs),
            const Text('파티원 모두의 목록에서 사라져요. 지난 기록은 남아요.', style: AppText.caption),
            const SizedBox(height: Gap.lg),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.coral),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('지우기'),
            ),
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          ],
        ),
      ),
    );
    if (ok == true) await ref.read(machinesProvider.notifier).delete(machine);
  }
}
