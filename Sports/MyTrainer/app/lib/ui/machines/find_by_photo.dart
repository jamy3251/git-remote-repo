import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';
import '../../data/workout.dart';
import '../../machines/machine.dart';
import '../../machines/machines_state.dart';
import '../../machines/matcher.dart';
import '../../state/workout.dart';
import '../log/exercise_picker.dart';

/// 기구 사진 한 장으로 종목·기구 고르기(설계 §3).
///
/// 1위가 임계값 이상이면 "이 기구 맞나요?" 확인 한 번, 아니면 상위 3개 중 고르기.
/// 못 찾으면 목록으로 넘어가고, 걸린 시간은 카메라를 연 순간부터 잰다(D15).
Future<void> findMachineByPhoto(BuildContext context, WidgetRef ref) async {
  final workout = ref.read(workoutProvider.notifier);
  workout.startPick();
  final path = await ref.read(photoSourceProvider).take();
  if (path == null) {
    workout.cancelPick();
    return;
  }

  final machines = ref.read(machinesProvider.notifier);
  MatchResult? result;
  String? problem;
  try {
    final v = (await machines.embedAll([path])).single;
    result = await machines.match(v);
  } catch (e) {
    problem = '사진을 읽지 못했어요. 목록에서 골라 주세요.';
  }
  if (!context.mounted) return;

  if (result != null && result.ranked.isEmpty) {
    problem = result.otherModel > 0
        ? '등록된 기구 사진이 예전 방식이라 비교할 수 없어요. 기구 사진을 다시 찍어 주세요.'
        : '등록된 기구가 없어요. 목록에서 고르거나 기구를 등록해 주세요.';
  }
  if (problem != null) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
    await showExercisePicker(context, ref, method: 'photo_list');
    return;
  }

  final history = ref.read(workoutProvider).valueOrNull?.history ?? const [];
  final picked = await showModalBottomSheet<_Pick>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _MatchSheet(result: result!, history: history),
  );
  if (!context.mounted) return;
  switch (picked) {
    case null:
      workout.cancelPick();
    case _Pick(machine: null):
      await showExercisePicker(context, ref, method: 'photo_list');
    case _Pick(:final machine?, :final exercise?, :final method):
      workout.selectExercise(exercise, variant: machine.variant, method: method);
    case _Pick():
      workout.cancelPick();
  }
}

class _Pick {
  const _Pick(this.machine, this.exercise, this.method);
  final Machine? machine;
  final Exercise? exercise;
  final String method;
}

class _MatchSheet extends StatefulWidget {
  const _MatchSheet({required this.result, required this.history});

  final MatchResult result;
  final List<WorkoutSet> history;

  @override
  State<_MatchSheet> createState() => _MatchSheetState();
}

class _MatchSheetState extends State<_MatchSheet> {
  late final Machine? _auto = widget.result.auto;
  late Machine? _chosen = _auto;
  Exercise? _exercise;

  @override
  void initState() {
    super.initState();
    if (_chosen != null) _exercise = defaultExerciseFor(_chosen!, widget.history);
  }

  void _choose(Machine m) => setState(() {
        _chosen = m;
        _exercise = defaultExerciseFor(m, widget.history);
      });

  @override
  Widget build(BuildContext context) {
    final top = widget.result.top3;
    final chosen = _chosen;
    // 1위를 그대로 확인하면 photo_auto, 상위 3개에서 다른 걸 고르면 photo_top3.
    final method = chosen != null && chosen.id == _auto?.id ? 'photo_auto' : 'photo_top3';

    return Padding(
      padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.lg, Gap.xl, Gap.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_auto != null ? '이 기구 맞나요?' : '어느 기구인가요?', style: AppText.title),
          const SizedBox(height: Gap.md),
          for (final s in top)
            _MachineTile(
              score: s,
              selected: chosen?.id == s.machine.id,
              onTap: () => _choose(s.machine),
            ),
          if (chosen != null && chosen.exercises.length > 1) ...[
            const SizedBox(height: Gap.md),
            Text('종목', style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
            const SizedBox(height: Gap.xs),
            Wrap(
              spacing: Gap.sm,
              children: [
                for (final e in chosen.exercises)
                  ChoiceChip(
                    label: Text(e.name),
                    selected: e.id == _exercise?.id,
                    onSelected: (_) => setState(() => _exercise = e),
                  ),
              ],
            ),
          ],
          const SizedBox(height: Gap.lg),
          FilledButton(
            onPressed: chosen == null || _exercise == null
                ? null
                : () => Navigator.pop(context, _Pick(chosen, _exercise, method)),
            child: Text(chosen == null ? '기구를 골라 주세요' : '${_exercise?.name ?? ''} 시작'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, const _Pick(null, null, 'photo_list')),
            child: const Text('목록에서 고르기'),
          ),
          if (widget.result.otherModel > 0)
            Text('예전 방식 사진 ${widget.result.otherModel}장은 비교하지 못했어요',
                style: AppText.micro.copyWith(color: AppColors.inkFaint), textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _MachineTile extends StatelessWidget {
  const _MachineTile({required this.score, required this.selected, required this.onTap});

  final MachineScore score;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
        elevation: 0,
        color: selected ? AppColors.tealSoft : AppColors.surfaceAlt,
        child: ListTile(
          onTap: onTap,
          leading: Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off,
              color: selected ? AppColors.teal : AppColors.inkFaint),
          title: Text(score.machine.name, style: AppText.bodyStrong),
          subtitle: Text(score.machine.exercises.map((e) => e.name).join(' · '), style: AppText.caption),
          trailing: Text('${(score.score * 100).round()}%',
              style: AppText.micro.copyWith(color: AppColors.inkFaint)),
        ),
      );
}

/// 기록 화면 위쪽에서 쓰는 "기구 관리" 버튼.
class MachinesAction extends StatelessWidget {
  const MachinesAction({super.key});

  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: '기구 관리',
        onPressed: () => context.push('/machines'),
        icon: const Icon(Icons.fitness_center),
      );
}
