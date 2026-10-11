import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../../core/theme.dart';
import '../../diet/diet_state.dart';
import '../../diet/meal.dart';
import '../../diet/nutrients.dart';
import '../../recommend/meal_planner.dart';
import '../widgets/coach_line.dart';
import '../widgets/panel.dart';

String kcal(double v) => '${v.round()}kcal';
String grams(double v) => '${v.round()}g';

/// 오늘 식단. 목표 대비 먹은 양, 끼니별 기록, 이번 끼니 추천.
class DietScreen extends ConsumerWidget {
  const DietScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meals = ref.watch(mealsProvider);
    final profile = ref.watch(bodyProfileProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('식단'), actions: [
        IconButton(
          tooltip: '몸 정보',
          onPressed: () => context.push('/diet/profile'),
          icon: const Icon(Icons.person_outline),
        ),
      ]),
      body: meals.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('식단을 불러오지 못했어요\n$e', style: AppText.body)),
        data: (_) => ListView(
          padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
          children: [
            if (profile.valueOrNull == null && !profile.isLoading)
              const _NoProfile()
            else
              const _TargetPanel(),
            const SizedBox(height: Gap.md),
            const _AddRow(),
            const SizedBox(height: Gap.md),
            const _MealPlanPanel(),
            const SizedBox(height: Gap.md),
            const _TodayMeals(),
          ],
        ),
      ),
    );
  }
}

class _NoProfile extends StatelessWidget {
  const _NoProfile();

  @override
  Widget build(BuildContext context) => Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('하루 목표가 아직 없어요', style: AppText.section),
          const SizedBox(height: Gap.xs),
          Text('키·몸무게·활동량·목표를 넣으면 열량과 탄수화물·단백질·지방 목표를 계산하고, 끼니를 추천해요.',
              style: AppText.caption),
          const SizedBox(height: Gap.md),
          FilledButton(onPressed: () => context.push('/diet/profile'), child: const Text('몸 정보 넣기')),
        ]),
      );
}

class _TargetPanel extends ConsumerWidget {
  const _TargetPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final target = ref.watch(dailyTargetProvider);
    if (target == null) return const SizedBox.shrink();
    final eaten = ref.watch(todayEatenProvider);
    final t = target.target;
    final left = t.kcal - eaten.kcal;
    final goal = ref.watch(bodyProfileProvider).valueOrNull?.goal;

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        PanelLabel('오늘 · ${goal?.label ?? ''} 목표 ${kcal(t.kcal)}'),
        Text(left >= 0 ? '${kcal(left)} 남았어요' : '${kcal(-left)} 넘었어요', style: AppText.title),
        const SizedBox(height: Gap.md),
        _Bar(label: '열량', got: eaten.kcal, want: t.kcal, unit: 'kcal', color: AppColors.teal),
        _Bar(label: '탄수화물', got: eaten.carb, want: t.carb, unit: 'g', color: AppColors.amber),
        _Bar(label: '단백질', got: eaten.protein, want: t.protein, unit: 'g', color: AppColors.plum),
        _Bar(label: '지방', got: eaten.fat, want: t.fat, unit: 'g', color: AppColors.coral),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            style: TextButton.styleFrom(padding: EdgeInsets.zero),
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (_) => Padding(
                padding: const EdgeInsets.all(Gap.xl),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('목표 계산 근거', style: AppText.section),
                  const SizedBox(height: Gap.md),
                  for (final r in target.reasons)
                    Padding(padding: const EdgeInsets.only(bottom: Gap.xs), child: Text(r, style: AppText.body)),
                  const SizedBox(height: Gap.sm),
                  Text('일반 성인 기준 계산식이에요. 질환이 있거나 임신 중이면 전문가와 정해 주세요.', style: AppText.caption),
                ]),
              ),
            ),
            child: const Text('어떻게 계산했나요?'),
          ),
        ),
      ]),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.label, required this.got, required this.want, required this.unit, required this.color});

  final String label;
  final double got, want;
  final String unit;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: Gap.sm),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(label, style: AppText.label)),
            Text('${got.round()} / ${want.round()}$unit',
                style: AppText.label.copyWith(color: got > want * 1.05 ? AppColors.coral : AppColors.inkSub)),
          ]),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: want <= 0 ? 0 : (got / want).clamp(0, 1).toDouble(),
              minHeight: 6,
              color: color,
              backgroundColor: AppColors.lineSoft,
            ),
          ),
        ]),
      );
}

class _AddRow extends ConsumerWidget {
  const _AddRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final photo = ref.watch(foodPhotoAnalyzerProvider).available;
    return Row(children: [
      Expanded(
        child: FilledButton.icon(
          onPressed: photo ? () => context.push('/diet/photo') : null,
          icon: const Icon(Icons.photo_camera_outlined),
          label: const Text('사진'),
        ),
      ),
      const SizedBox(width: Gap.sm),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: () => context.push('/diet/search'),
          icon: const Icon(Icons.search),
          label: const Text('검색'),
        ),
      ),
      const SizedBox(width: Gap.sm),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: () => context.push('/diet/manual'),
          icon: const Icon(Icons.edit_outlined),
          label: const Text('직접'),
        ),
      ),
    ]);
  }
}

class _MealPlanPanel extends ConsumerWidget {
  const _MealPlanPanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final plan = ref.watch(mealPlanProvider).valueOrNull;
    if (plan == null) return const SizedBox.shrink();
    final t = plan.mealTarget;
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        PanelLabel('${plan.meal.label} 추천'),
        Text('이번 끼니 ${kcal(t.kcal)} · 탄 ${grams(t.carb)} 단 ${grams(t.protein)} 지 ${grams(t.fat)}',
            style: AppText.bodyStrong),
        const SizedBox(height: Gap.md),
        if (plan.suggestions.isEmpty)
          Text(plan.note, style: AppText.caption)
        else ...[
          for (final s in plan.suggestions) _Suggestion(s: s, meal: plan.meal),
          CoachLine(
            facts: {
              'kind': 'meal',
              'meal': plan.meal.label,
              'mealTarget': _round(t),
              'best': [for (final i in plan.suggestions.first.items) '${i.candidate.name} ${grams(i.amount)}'],
              'bestTotal': _round(plan.suggestions.first.total),
            },
            reasons: [plan.note, '단백질 음식 하나와 탄수화물 음식 하나로 이번 끼니 목표에 가장 가까운 양을 골랐어요'],
          ),
        ],
      ]),
    );
  }

  static Map<String, int> _round(Nutrients n) =>
      {'kcal': n.kcal.round(), 'carb': n.carb.round(), 'protein': n.protein.round(), 'fat': n.fat.round()};
}

class _Suggestion extends ConsumerWidget {
  const _Suggestion({required this.s, required this.meal});

  final MealSuggestion s;
  final MealType meal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final total = s.total;
    return Padding(
      padding: const EdgeInsets.only(bottom: Gap.md),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.items.map((i) => '${i.candidate.name} ${grams(i.amount)}').join(' + '), style: AppText.body),
            Text('${kcal(total.kcal)} · 탄 ${grams(total.carb)} 단 ${grams(total.protein)} 지 ${grams(total.fat)}'
                '${s.items.any((i) => i.candidate.familiar) ? ' · 자주 먹는 음식' : ''}',
                style: AppText.caption),
          ]),
        ),
        TextButton(
          onPressed: () async {
            final now = ref.read(clockProvider)();
            await ref.read(mealsProvider.notifier).add([
              for (final i in s.items)
                MealEntry(
                  id: const Uuid().v4(),
                  at: now,
                  meal: meal,
                  name: i.candidate.name,
                  amount: i.amount,
                  unit: i.candidate.unit,
                  nutrients: i.nutrients,
                  source: MealSource.recommended,
                  foodCode: i.candidate.code,
                ),
            ]);
          },
          child: const Text('먹었어요'),
        ),
      ]),
    );
  }
}

class _TodayMeals extends ConsumerWidget {
  const _TodayMeals();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = ref.watch(todayMealsProvider);
    if (today.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: Gap.lg),
        child: Text('오늘 먹은 것이 아직 없어요.\n사진 한 장이나 검색으로 남겨 보세요.',
            style: AppText.body.copyWith(color: AppColors.inkSub), textAlign: TextAlign.center),
      );
    }
    final hhmm = DateFormat('HH:mm');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final type in MealType.values)
        if (today.where((m) => m.meal == type).toList() case final list when list.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.md),
            child: Panel(
              padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.sm, Gap.sm),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(type.label, style: AppText.section)),
                  Padding(
                    padding: const EdgeInsets.only(right: Gap.sm),
                    child: Text(kcal(list.fold(0.0, (a, m) => a + m.nutrients.kcal)), style: AppText.label),
                  ),
                ]),
                for (final m in list)
                  Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(m.amount > 0 ? '${m.name} ${m.amount.round()}${m.unit}' : m.name, style: AppText.body),
                        Text(
                          '${hhmm.format(m.at)} · ${kcal(m.nutrients.kcal)} · 탄 ${grams(m.nutrients.carb)} '
                          '단 ${grams(m.nutrients.protein)} 지 ${grams(m.nutrients.fat)}'
                          '${m.aiEstimated ? ' · AI 추정' : ''}',
                          style: AppText.caption,
                        ),
                      ]),
                    ),
                    IconButton(
                      tooltip: '지우기',
                      onPressed: () => ref.read(mealsProvider.notifier).remove(m.id),
                      icon: const Icon(Icons.close, size: 18, color: AppColors.inkFaint),
                    ),
                  ]),
              ]),
            ),
          ),
    ]);
  }
}

/// 끼니 고르기 칩. 검색·직접·사진 화면이 같이 쓴다.
class MealTypeChips extends StatelessWidget {
  const MealTypeChips({super.key, required this.value, required this.onChanged});

  final MealType value;
  final ValueChanged<MealType> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(spacing: Gap.sm, children: [
        for (final t in MealType.values)
          ChoiceChip(label: Text(t.label), selected: t == value, onSelected: (_) => onChanged(t)),
      ]);
}
