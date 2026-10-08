import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';
import '../../data/models.dart';
import '../../data/workout.dart';
import '../../machines/machines_state.dart';
import '../../routines/routines_state.dart';
import '../../services/logging_rules.dart';
import '../../state/workout.dart';
import '../machines/find_by_photo.dart';
import '../widgets/panel.dart';
import 'exercise_picker.dart';
import 'sparkline.dart';

/// 세트 기록 화면.
///
/// 세트 사이에 흘끗 보고 한 번 누르는 화면이다. 그래서 무게·횟수는 늘 미리 채워져
/// 있고, 가장 큰 버튼이 "같은 세트 기록"이다. 바꿀 때만 ± 를 누른다.
class LogScreen extends ConsumerWidget {
  const LogScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(workoutProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('운동 기록'), actions: [
        IconButton(
          tooltip: '루틴',
          onPressed: () => context.push('/routines'),
          icon: const Icon(Icons.list_alt),
        ),
        const MachinesAction(),
      ]),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('기록을 불러오지 못했어요\n$e', style: AppText.body)),
        data: (s) => s.exercise == null ? const _FirstPick() : _Logger(state: s),
      ),
    );
  }
}

class _FirstPick extends ConsumerWidget {
  const _FirstPick();

  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
        padding: const EdgeInsets.all(Gap.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const RoutineStrip(),
            const Text('어떤 운동부터 할까요?', style: AppText.title, textAlign: TextAlign.center),
            const SizedBox(height: Gap.lg),
            FilledButton(
              onPressed: () => showExercisePicker(context, ref),
              child: const Text('종목 고르기'),
            ),
            const SizedBox(height: Gap.sm),
            OutlinedButton.icon(
              onPressed: () => findMachineByPhoto(context, ref),
              icon: const Icon(Icons.photo_camera_outlined),
              label: const Text('기구 사진으로 찾기'),
            ),
          ],
        ),
      );
}

/// 오늘 루틴: 종목마다 오늘 한 세트/목표 세트. 누르면 그 종목을 루틴 목표로 시작한다.
class RoutineStrip extends ConsumerWidget {
  const RoutineStrip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routine = ref.watch(activeRoutineProvider);
    final w = ref.watch(workoutProvider).valueOrNull;
    if (routine == null || w == null) return const SizedBox.shrink();
    final today = dayKey(DateTime.now());
    int done(String exerciseId) =>
        w.history.where((s) => s.exerciseId == exerciseId && dayKey(s.at) == today).length;
    final next = routine.items.where((i) => done(i.exerciseId) < i.sets).firstOrNull;

    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.md),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('오늘 루틴 · ${routine.name}', style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
        const SizedBox(height: Gap.xs),
        Wrap(spacing: Gap.sm, runSpacing: Gap.xs, children: [
          for (final i in routine.items)
            if (i.exercise case final ex?)
              ChoiceChip(
                label: Text('${ex.name} ${done(i.exerciseId)}/${i.sets}'),
                selected: w.exercise?.id == i.exerciseId,
                avatar: i == next && w.exercise?.id != i.exerciseId
                    ? const Icon(Icons.arrow_forward, size: 16)
                    : (done(i.exerciseId) >= i.sets ? const Icon(Icons.check, size: 16) : null),
                onSelected: (_) => ref.read(workoutProvider.notifier).selectFromRoutine(
                      ex,
                      i.variant,
                      targetReps: i.repsMin,
                      weightKg: i.weightKg,
                    ),
              ),
        ]),
      ]),
    );
  }
}

/// 기구 변형 고르기. 사진으로 고른 머신(machine:<그룹>)은 기구 이름으로 보인다.
class _VariantChips extends ConsumerWidget {
  const _VariantChips({required this.state});

  final WorkoutState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ex = state.exercise!;
    final current = state.variant!;
    final machines = ref.watch(machinesProvider).valueOrNull;
    final variants = [
      ...ex.variants,
      if (!ex.variants.contains(current)) current,
    ];
    if (variants.length < 2) return const SizedBox.shrink();

    String label(Variant v) {
      if (!v.isMachine || v == Variant.machineGeneric) return v.label;
      return machines?.byGroup(v.key.substring('machine:'.length))?.name ?? v.label;
    }

    return Wrap(
      spacing: Gap.sm,
      children: [
        for (final v in variants)
          ChoiceChip(
            label: Text(label(v)),
            selected: v == current,
            onSelected: (_) => ref.read(workoutProvider.notifier).selectVariant(v),
          ),
      ],
    );
  }
}

String _kg(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

class _Logger extends ConsumerWidget {
  const _Logger({required this.state});

  final WorkoutState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ctrl = ref.read(workoutProvider.notifier);
    final ex = state.exercise!;
    final today = dayKey(DateTime.now());
    final todaySets = state.history
        .where((x) => x.key == state.key && dayKey(x.at) == today)
        .toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    final lastAny = state.history
        .where((x) => dayKey(x.at) == today)
        .fold<DateTime?>(null, (m, x) => m == null || x.at.isAfter(m) ? x.at : m);
    final repeat = state.prefillSource == PrefillSource.previousSet && state.pendingTaps == 0;
    final bodyweight = state.variant == Variant.bodyweight;

    return ListView(
      padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.sm, Gap.xl, Gap.huge),
      children: [
        const RoutineStrip(),
        // 종목 + 기구
        InkWell(
          borderRadius: BorderRadius.circular(Radii.card),
          onTap: () => showExercisePicker(context, ref),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Gap.sm),
            child: Row(children: [
              Expanded(child: Text(ex.name, style: AppText.display)),
              Text('바꾸기', style: AppText.label.copyWith(color: AppColors.teal)),
              IconButton(
                tooltip: '기구 사진으로 바꾸기',
                onPressed: () => findMachineByPhoto(context, ref),
                icon: const Icon(Icons.photo_camera_outlined, color: AppColors.teal),
              ),
            ]),
          ),
        ),
        _VariantChips(state: state),
        const SizedBox(height: Gap.lg),

        Panel(
          child: Column(children: [
            if (!bodyweight)
              _Stepper(
                label: '무게',
                value: '${_kg(state.weightKg)} kg',
                onMinus: () => ctrl.adjustWeight(-2.5),
                onPlus: () => ctrl.adjustWeight(2.5),
                onTapValue: () => _typeWeight(context, ref, state.weightKg),
              ),
            if (!bodyweight) const Divider(height: Gap.xxl),
            _Stepper(
              label: '횟수',
              value: '${state.reps}회',
              onMinus: () => ctrl.adjustReps(-1),
              onPlus: () => ctrl.adjustReps(1),
            ),
          ]),
        ),
        const SizedBox(height: Gap.md),
        SizedBox(
          height: 56,
          child: FilledButton(
            onPressed: () async {
              HapticFeedback.lightImpact();
              await ctrl.logSet();
            },
            child: Text(repeat ? '같은 세트 기록' : '세트 기록', style: AppText.section.copyWith(color: Colors.white)),
          ),
        ),
        Align(
          child: TextButton(
            onPressed: () => _pickFailure(context, ref, state.reps),
            child: const Text('중간에 실패했어요'),
          ),
        ),
        if (lastAny != null) _RestTimer(since: lastAny),
        const SizedBox(height: Gap.md),

        if (todaySets.isNotEmpty) ...[
          const PanelLabel('오늘 이 종목'),
          Panel(
            padding: const EdgeInsets.symmetric(horizontal: Gap.lg, vertical: Gap.sm),
            child: Column(children: [
              for (final (i, x) in todaySets.indexed) _SetRow(index: i + 1, set: x, bodyweight: bodyweight),
            ]),
          ),
          const SizedBox(height: Gap.md),
        ],
        _OneRmCard(state: state),
      ],
    );
  }

  Future<void> _typeWeight(BuildContext context, WidgetRef ref, double current) async {
    final c = TextEditingController(text: _kg(current));
    final v = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('무게 입력'),
        content: TextField(
          controller: c,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(suffixText: 'kg'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, double.tryParse(c.text.replaceAll(',', '.'))),
            child: const Text('확인'),
          ),
        ],
      ),
    );
    if (v != null) ref.read(workoutProvider.notifier).setWeight(v);
  }

  Future<void> _pickFailure(BuildContext context, WidgetRef ref, int target) async {
    final at = await showModalBottomSheet<int>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Gap.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('몇 번째 회차에서 무너졌나요?', style: AppText.section),
              const SizedBox(height: Gap.xs),
              Text('그 앞까지 해낸 횟수로 기록하고, 무너진 지점을 따로 남겨요.', style: AppText.caption),
              const SizedBox(height: Gap.lg),
              Wrap(
                spacing: Gap.sm,
                runSpacing: Gap.sm,
                children: [
                  for (var r = 1; r <= target + 2; r++)
                    OutlinedButton(onPressed: () => Navigator.pop(ctx, r), child: Text('$r회째')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (at != null) await ref.read(workoutProvider.notifier).logSet(failedAtRep: at);
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({
    required this.label,
    required this.value,
    required this.onMinus,
    required this.onPlus,
    this.onTapValue,
  });

  final String label;
  final String value;
  final VoidCallback onMinus;
  final VoidCallback onPlus;
  final VoidCallback? onTapValue;

  @override
  Widget build(BuildContext context) => Row(children: [
        SizedBox(width: 44, child: Text(label, style: AppText.label.copyWith(color: AppColors.inkSub))),
        IconButton.outlined(onPressed: onMinus, icon: const Icon(Icons.remove)),
        Expanded(
          child: GestureDetector(
            onTap: onTapValue,
            child: Text(value, style: AppText.moneyLarge, textAlign: TextAlign.center),
          ),
        ),
        IconButton.outlined(onPressed: onPlus, icon: const Icon(Icons.add)),
      ]);
}

class _SetRow extends ConsumerWidget {
  const _SetRow({required this.index, required this.set, required this.bodyweight});

  final int index;
  final WorkoutSet set;
  final bool bodyweight;

  @override
  Widget build(BuildContext context, WidgetRef ref) => InkWell(
        onLongPress: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: Text('$index세트를 지울까요?'),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
                TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('지우기')),
              ],
            ),
          );
          if (ok == true) await ref.read(workoutProvider.notifier).deleteSet(set.id);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Gap.sm),
          child: Row(children: [
            SizedBox(width: 28, child: Text('$index', style: AppText.label.copyWith(color: AppColors.inkFaint))),
            Expanded(
              child: Text(
                bodyweight ? '${set.reps}회' : '${_kg(set.weightKg)} kg × ${set.reps}',
                style: AppText.bodyStrong,
              ),
            ),
            if (set.failed)
              Text('${set.failedAtRep}회째 실패', style: AppText.caption.copyWith(color: AppColors.coral)),
          ]),
        ),
      );
}

class _RestTimer extends StatefulWidget {
  const _RestTimer({required this.since});
  final DateTime since;

  @override
  State<_RestTimer> createState() => _RestTimerState();
}

class _RestTimerState extends State<_RestTimer> {
  late final Timer _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));

  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = DateTime.now().difference(widget.since);
    // 한 시간 넘게 지났으면 휴식이 아니라 다른 날 운동처럼 보인다. 숨긴다.
    if (d > const Duration(hours: 1)) return const SizedBox.shrink();
    final m = d.inMinutes, s = d.inSeconds % 60;
    return Center(
      child: Text('휴식 $m:${s.toString().padLeft(2, '0')}',
          style: AppText.label.copyWith(color: AppColors.inkSub)),
    );
  }
}

class _OneRmCard extends ConsumerWidget {
  const _OneRmCard({required this.state});
  final WorkoutState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = estimateOneRm(state.weightKg, state.reps);
    final trend = ref.read(loggingRulesProvider).oneRmTrend(state.history, state.key!);
    if (now == null && trend.isEmpty) return const SizedBox.shrink();
    final best = trend.isEmpty ? null : trend.map((e) => e.oneRm).reduce((a, b) => a > b ? a : b);

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PanelLabel('추정 1RM · ${state.exercise!.name} ${state.variant!.label}'),
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(now == null ? '-' : '${_kg(_round(now))} kg', style: AppText.title),
            const SizedBox(width: Gap.sm),
            if (best != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Text('최고 ${_kg(_round(best))} kg', style: AppText.caption),
              ),
          ]),
          Text('지금 입력한 무게·횟수 기준, 10회 이하 세트만 계산해요.', style: AppText.micro.copyWith(color: AppColors.inkFaint)),
          if (trend.length >= 2) ...[
            const SizedBox(height: Gap.md),
            SizedBox(height: 56, child: Sparkline(values: [for (final e in trend) e.oneRm])),
          ],
        ],
      ),
    );
  }

  static double _round(double v) => (v * 2).round() / 2;
}
