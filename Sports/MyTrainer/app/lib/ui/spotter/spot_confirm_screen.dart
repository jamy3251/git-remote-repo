import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';
import '../../party/party_state.dart';
import '../../spotter/spot_repository.dart';
import '../../state/workout.dart';
import '../widgets/panel.dart';

/// 확인 화면에 넘기는 것. 친구가 보낸 결과([spot])거나, 삼각대로 직접 찍은 것.
class SpotDraft {
  const SpotDraft({required this.reps, required this.at, this.spot, this.variant = Variant.barbell});

  factory SpotDraft.fromSpot(PendingSpot s) =>
      SpotDraft(reps: s.reps, at: s.createdAt, spot: s, variant: s.variant);

  final int reps;
  final DateTime at;
  final PendingSpot? spot;
  final Variant variant;
}

/// 리프터가 무게를 넣고 횟수를 고쳐 저장해야 기록이 된다(설계 §4).
class SpotConfirmScreen extends ConsumerStatefulWidget {
  const SpotConfirmScreen({super.key, required this.draft});

  final SpotDraft draft;

  @override
  ConsumerState<SpotConfirmScreen> createState() => _SpotConfirmScreenState();
}

class _SpotConfirmScreenState extends ConsumerState<SpotConfirmScreen> {
  static final _exercise = exerciseById('squat')!;

  late int _reps = widget.draft.reps;
  late Variant _variant = widget.draft.variant;
  double? _weight;
  bool _busy = false;

  /// 그 기구로 한 마지막 스쿼트 무게로 채운다.
  double _prefill() {
    final history = ref.read(workoutProvider).valueOrNull?.history ?? const [];
    return ref.read(loggingRulesProvider).prefill(history, _exercise.id, _variant, DateTime.now()).weightKg;
  }

  void _addWeight(double d) => setState(() => _weight = ((_weight ?? _prefill()) + d).clamp(0, 500).toDouble());

  Future<void> _save() async {
    setState(() => _busy = true);
    final d = widget.draft;
    await ref.read(workoutProvider.notifier).logSpotted(
          exercise: _exercise,
          variant: _variant,
          weightKg: _weight ?? _prefill(),
          reps: _reps,
          at: d.at,
          spotId: d.spot?.id ?? 'self-${d.at.millisecondsSinceEpoch}',
          spottedBy: d.spot?.spotterId,
        );
    if (d.spot != null) await ref.read(spotRepositoryProvider).confirm(d.spot!, _reps);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('스쿼트 $_reps회를 기록했어요')));
    Navigator.pop(context);
  }

  Future<void> _reject() async {
    await ref.read(spotRepositoryProvider).reject(widget.draft.spot!);
    if (mounted) Navigator.pop(context);
  }

  Widget _stepper(String label, String value, VoidCallback minus, VoidCallback plus) => Row(children: [
        Expanded(child: Text(label, style: AppText.body)),
        IconButton.outlined(onPressed: minus, icon: const Icon(Icons.remove)),
        SizedBox(width: 96, child: Text(value, style: AppText.title, textAlign: TextAlign.center)),
        IconButton.outlined(onPressed: plus, icon: const Icon(Icons.add)),
      ]);

  @override
  Widget build(BuildContext context) {
    // 기록이 로드되면 미리 채우기가 바뀔 수 있어 지켜본다.
    ref.watch(workoutProvider);
    final spot = widget.draft.spot;
    final spotter = spot == null ? null : ref.watch(partyViewProvider).valueOrNull?.nameOf(spot.spotterId);
    final weight = _weight ?? _prefill();
    String kg(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

    return Scaffold(
      appBar: AppBar(title: const Text('스쿼트 확인')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          Text(spot == null ? '직접 찍은 스쿼트' : '${spotter ?? '파티원'}님이 찍었어요', style: AppText.title),
          const SizedBox(height: Gap.xs),
          Text('횟수가 맞는지 보고 무게를 넣어 주세요. 저장해야 내 기록이 돼요.', style: AppText.caption),
          const SizedBox(height: Gap.lg),
          Wrap(spacing: Gap.sm, children: [
            for (final v in _exercise.variants)
              ChoiceChip(
                label: Text(v.label),
                selected: v == _variant,
                onSelected: (_) => setState(() {
                  _variant = v;
                  _weight = null;
                }),
              ),
          ]),
          const SizedBox(height: Gap.md),
          Panel(
            child: Column(children: [
              _stepper('무게', '${kg(weight)} kg', () => _addWeight(-2.5), () => _addWeight(2.5)),
              const Divider(height: Gap.xxl),
              _stepper('횟수', '$_reps회', () => setState(() => _reps = (_reps - 1).clamp(0, 100)),
                  () => setState(() => _reps = (_reps + 1).clamp(0, 100))),
            ]),
          ),
          const SizedBox(height: Gap.lg),
          SizedBox(
            height: 56,
            child: FilledButton(
              onPressed: _busy || _reps == 0 ? null : _save,
              child: Text('기록에 저장', style: AppText.section.copyWith(color: Colors.white)),
            ),
          ),
          if (spot != null)
            TextButton(onPressed: _busy ? null : _reject, child: const Text('내 세트가 아니에요')),
        ],
      ),
    );
  }
}
