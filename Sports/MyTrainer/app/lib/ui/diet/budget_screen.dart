import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../diet/price.dart';
import '../../diet/price_state.dart';
import '../../recommend/budget_planner.dart';
import '../widgets/panel.dart';
import 'diet_screen.dart';

final _won = NumberFormat('#,###');
String won(num v) => '${_won.format(v.round())}원';

/// 먹는 양을 사람이 알아보기 쉽게. 달걀은 개수, 쌀은 밥 무게도.
String amountText(PlanItem i) {
  final it = i.food.item;
  final g = i.grams.round();
  if (it.pieceGrams != null) {
    final n = (i.grams / it.pieceGrams! * 2).round() / 2;
    return '약 ${n == n.roundToDouble() ? n.toInt() : n}${it.pieceLabel} (${g}g)';
  }
  if (it.cooked != null) return '${g}g (밥 약 ${(i.grams * it.cooked! / 10).round() * 10}g)';
  return '${g}g';
}

/// 동네 시세로 짠 일주일 다이어트 식단과 그 값.
class BudgetScreen extends ConsumerStatefulWidget {
  const BudgetScreen({super.key});

  @override
  ConsumerState<BudgetScreen> createState() => _BudgetScreenState();
}

class _BudgetScreenState extends ConsumerState<BudgetScreen> {
  int _day = 0;

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(budgetPlanProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('장보기 식단')),
      body: switch (plan) {
        AsyncData(value: null) => Padding(
            padding: const EdgeInsets.all(Gap.xl),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Text('하루 목표가 있어야 식단을 짤 수 있어요', style: AppText.section, textAlign: TextAlign.center),
              const SizedBox(height: Gap.md),
              FilledButton(onPressed: () => context.push('/diet/profile'), child: const Text('몸 정보 넣기')),
            ]),
          ),
        AsyncData(value: final BudgetPlan p) when p.isEmpty =>
          Center(child: Text(p.reasons.join('\n'), style: AppText.body, textAlign: TextAlign.center)),
        AsyncData(value: final BudgetPlan p) => ListView(
            padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
            children: [
              _Summary(plan: p),
              const SizedBox(height: Gap.md),
              Wrap(spacing: Gap.sm, children: [
                for (var d = 0; d < p.days.length; d++)
                  ChoiceChip(label: Text('${d + 1}일'), selected: d == _day, onSelected: (_) => setState(() => _day = d)),
              ]),
              const SizedBox(height: Gap.md),
              _DayCard(day: p.days[_day.clamp(0, p.days.length - 1)]),
              const SizedBox(height: Gap.md),
              _Shopping(plan: p),
              const SizedBox(height: Gap.md),
              const _PriceTable(),
            ],
          ),
        AsyncError(:final error) => Center(child: Text('식단을 짜지 못했어요\n$error', style: AppText.body)),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Summary extends ConsumerWidget {
  const _Summary({required this.plan});
  final BudgetPlan plan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final avg = plan.dayAverage;
    final t = plan.target;
    final region = ref.watch(priceRegionProvider).valueOrNull;
    final foods = ref.watch(pricedFoodsProvider).valueOrNull ?? const <PricedFood>[];
    final bySource = <PriceSource, int>{};
    for (final f in foods) {
      bySource[f.price.source] = (bySource[f.price.source] ?? 0) + 1;
    }
    final dates = {for (final f in foods) if (f.price.date != null) f.price.date!}.toList()..sort();

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PanelLabel('일주일 다이어트 식단'),
        Text('하루 약 ${won(plan.dayWon)}', style: AppText.title),
        Text('일주일 먹는 양 ${won(plan.dayWon * plan.days.length)} · 첫 장보기 ${won(plan.shopWon)}', style: AppText.label),
        const SizedBox(height: Gap.sm),
        Text(
          '하루 평균 ${kcal(avg.kcal)} · 탄 ${grams(avg.carb)} 단 ${grams(avg.protein)} 지 ${grams(avg.fat)}'
          '  (목표 ${kcal(t.kcal)} · 단 ${grams(t.protein)})',
          style: AppText.caption,
        ),
        const SizedBox(height: Gap.md),
        Text(
          [
            '가격: ${region?.name ?? '지역 시세 없음'}',
            for (final e in bySource.entries) '${e.key.label} ${e.value}개',
            if (dates.isNotEmpty) '조사일 ${dates.first == dates.last ? dates.first : '${dates.first}~${dates.last}'}',
          ].join(' · '),
          style: AppText.caption,
        ),
        if (bySource.containsKey(PriceSource.base))
          Text('참고값은 2026년 10월 어림값이에요. 동네 가게 값으로 아래에서 고칠 수 있어요.', style: AppText.caption),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            style: TextButton.styleFrom(padding: EdgeInsets.zero),
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (_) => Padding(
                padding: const EdgeInsets.all(Gap.xl),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('어떻게 짰나요?', style: AppText.section),
                  const SizedBox(height: Gap.md),
                  for (final r in plan.reasons)
                    Padding(padding: const EdgeInsets.only(bottom: Gap.xs), child: Text(r, style: AppText.body)),
                  const SizedBox(height: Gap.sm),
                  Text('조리법·양념은 넣지 않은 대략적인 식단이에요. 질환이 있으면 전문가와 정해 주세요.', style: AppText.caption),
                ]),
              ),
            ),
            child: const Text('어떻게 짰나요?'),
          ),
        ),
      ]),
    );
  }
}

class _DayCard extends StatelessWidget {
  const _DayCard({required this.day});
  final PlanDay day;

  @override
  Widget build(BuildContext context) => Column(children: [
        for (final m in day.meals)
          Padding(
            padding: const EdgeInsets.only(bottom: Gap.sm),
            child: Panel(
              padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.lg, Gap.md),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(m.type.label, style: AppText.section)),
                  Text('${kcal(m.total.kcal)} · ${won(m.won)}', style: AppText.label),
                ]),
                const SizedBox(height: Gap.xs),
                for (final i in m.items)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Row(children: [
                      Expanded(child: Text('${i.food.item.name} ${amountText(i)}', style: AppText.body)),
                      Text(won(i.won), style: AppText.caption),
                    ]),
                  ),
                Text('단백질 ${grams(m.total.protein)} · 탄수화물 ${grams(m.total.carb)} · 지방 ${grams(m.total.fat)}',
                    style: AppText.caption),
              ]),
            ),
          ),
      ]);
}

class _Shopping extends StatelessWidget {
  const _Shopping({required this.plan});
  final BudgetPlan plan;

  @override
  Widget build(BuildContext context) => Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PanelLabel('일주일 장보기'),
          for (final s in plan.shopping)
            InkWell(
              onTap: () => showPriceSheet(context, s.food),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.xs),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${s.food.item.name} ${s.food.item.packLabel} × ${s.packs}', style: AppText.body),
                      Text('먹는 양 ${grams(s.grams)}${s.leftover >= 1 ? ' · 남는 양 ${grams(s.leftover)}' : ''}',
                          style: AppText.caption),
                    ]),
                  ),
                  Text(won(s.won), style: AppText.bodyStrong),
                ]),
              ),
            ),
          const Divider(height: Gap.lg),
          Row(children: [
            const Expanded(child: Text('합계', style: AppText.section)),
            Text(won(plan.shopWon), style: AppText.section),
          ]),
          Text('쌀·기름처럼 큰 단위로 파는 것은 남는 양까지 값에 들어 있어요. 줄을 누르면 값을 고칠 수 있어요.', style: AppText.caption),
        ]),
      );
}

class _PriceTable extends ConsumerWidget {
  const _PriceTable();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final foods = ref.watch(pricedFoodsProvider).valueOrNull ?? const <PricedFood>[];
    return Panel(
      padding: EdgeInsets.zero,
      child: ExpansionTile(
        shape: const Border(),
        title: const Text('식재료 값·영양 전체', style: AppText.section),
        childrenPadding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.md),
        children: [
          for (final f in foods)
            InkWell(
              onTap: () => showPriceSheet(context, f),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Gap.xs),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${f.item.name} ${f.item.packLabel}', style: AppText.body),
                      Text(
                        '100g ${kcal(f.per100.kcal)} 단 ${grams(f.per100.protein)} · ${f.fromDb ? '식약처 DB' : '영양 기본값'} · '
                        '${f.price.source.label}${f.price.date == null ? '' : ' ${f.price.date}'}',
                        style: AppText.caption,
                      ),
                    ]),
                  ),
                  Text(won(f.price.won), style: AppText.label),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}

/// 한 품목 값 고치기. 비우고 저장하면 받은 시세(또는 참고값)로 돌아간다.
Future<void> showPriceSheet(BuildContext context, PricedFood f) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _PriceSheet(food: f),
    );

class _PriceSheet extends ConsumerStatefulWidget {
  const _PriceSheet({required this.food});
  final PricedFood food;

  @override
  ConsumerState<_PriceSheet> createState() => _PriceSheetState();
}

class _PriceSheetState extends ConsumerState<_PriceSheet> {
  late final _c = TextEditingController(
      text: widget.food.price.source == PriceSource.user ? '${widget.food.price.won}' : '');

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _save(int? v) async {
    await ref.read(priceOverridesProvider.notifier).set(widget.food.item.id, v);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.food;
    return Padding(
      padding: EdgeInsets.fromLTRB(Gap.xl, Gap.xl, Gap.xl, Gap.xl + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${f.item.name} ${f.item.packLabel}', style: AppText.section),
        const SizedBox(height: Gap.xs),
        Text('지금 ${won(f.price.won)} · ${f.price.source.label}${f.price.region == null ? '' : ' (${f.price.region})'}',
            style: AppText.caption),
        const SizedBox(height: Gap.md),
        TextField(
          controller: _c,
          autofocus: true,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(labelText: '우리 동네 값', suffixText: '원', hintText: '${f.price.won}'),
        ),
        const SizedBox(height: Gap.lg),
        Row(children: [
          if (f.price.source == PriceSource.user)
            TextButton(onPressed: () => _save(null), child: const Text('받은 값으로 되돌리기')),
          const Spacer(),
          FilledButton(
            onPressed: () {
              final v = int.tryParse(_c.text);
              if (v != null && v > 0) _save(v);
            },
            child: const Text('저장'),
          ),
        ]),
      ]),
    );
  }
}
