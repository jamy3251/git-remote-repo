import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';
import '../../state/workout.dart';

/// 종목 고르기. 최근 한 종목+기구가 맨 위(기본 입력 경로), 그 아래 부위별 전체 목록.
///
/// [method] 는 고르기 방법 기록용(D15). 사진으로 못 찾고 넘어온 경우 'photo_list'.
Future<void> showExercisePicker(BuildContext context, WidgetRef ref, {String? method}) async {
  final ctrl = ref.read(workoutProvider.notifier)..startPick();
  final picked = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _Picker(method: method),
  );
  if (picked != true) ctrl.cancelPick();
}

class _Picker extends ConsumerStatefulWidget {
  const _Picker({this.method});

  final String? method;

  @override
  ConsumerState<_Picker> createState() => _PickerState();
}

class _PickerState extends ConsumerState<_Picker> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final history = ref.watch(workoutProvider).valueOrNull?.history ?? const [];
    final recent = ref.read(loggingRulesProvider).recent(history);
    final ctrl = ref.read(workoutProvider.notifier);

    void pick(Exercise e, [Variant? v]) {
      ctrl.selectExercise(e, variant: v, method: widget.method ?? (v == null ? 'list' : 'recent'));
      Navigator.pop(context, true);
    }

    final q = _q.trim();
    final matches = exerciseCatalog.where((e) => q.isEmpty || e.name.contains(q)).toList();
    final groups = <String, List<Exercise>>{};
    for (final e in matches) {
      (groups[e.group] ??= []).add(e);
    }

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.lg, Gap.xl, Gap.huge),
        children: [
          TextField(
            decoration: const InputDecoration(
              hintText: '종목 찾기',
              prefixIcon: Icon(Icons.search),
            ),
            onChanged: (v) => setState(() => _q = v),
          ),
          if (q.isEmpty && recent.isNotEmpty) ...[
            const SizedBox(height: Gap.lg),
            Text('최근', style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
            for (final r in recent)
              if (exerciseById(r.exerciseId) case final e?)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(e.name, style: AppText.bodyStrong),
                  trailing: Text(r.variant.label, style: AppText.caption),
                  onTap: () => pick(e, r.variant),
                ),
          ],
          for (final g in groups.entries) ...[
            const SizedBox(height: Gap.lg),
            Text(g.key, style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
            for (final e in g.value)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(e.name, style: AppText.body),
                trailing: Text(e.variants.map((v) => v.label).join(' · '),
                    style: AppText.micro.copyWith(color: AppColors.inkFaint)),
                onTap: () => pick(e),
              ),
          ],
          if (matches.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Gap.xl),
              child: Text('"$q" 와 맞는 종목이 없어요', style: AppText.caption),
            ),
        ],
      ),
    );
  }
}
