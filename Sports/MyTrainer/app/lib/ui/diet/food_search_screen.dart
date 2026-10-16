import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/theme.dart';
import '../../diet/diet_state.dart';
import '../../diet/food.dart';
import '../../diet/food_db.dart';
import '../../diet/meal.dart';
import '../../diet/meal_draft.dart';
import '../../diet/nutrients.dart';
import 'diet_screen.dart';

/// 음식 이름으로 찾아 양을 정해 남긴다. 검색어가 없으면 최근 먹은 음식.
class FoodSearchScreen extends ConsumerStatefulWidget {
  const FoodSearchScreen({super.key});

  @override
  ConsumerState<FoodSearchScreen> createState() => _FoodSearchScreenState();
}

class _FoodSearchScreenState extends ConsumerState<FoodSearchScreen> {
  String _q = '';

  /// 양을 적은 최근 기록(이름별 마지막 것)을 음식으로 되살린다.
  List<Food> _recent() {
    final meals = ref.watch(mealsProvider).valueOrNull ?? const <MealEntry>[];
    final seen = <String>{};
    return [
      for (final m in meals.reversed)
        if (m.amount > 0 && seen.add(normalizeFoodName(m.name)))
          Food(code: m.foodCode ?? '', name: m.name, unit: m.unit, per100: m.nutrients * (100 / m.amount), servingSize: m.amount),
    ].take(12).toList();
  }

  @override
  Widget build(BuildContext context) {
    final index = ref.watch(foodIndexProvider);
    final List<Food> results;
    final String? note;
    if (_q.trim().isEmpty) {
      results = _recent();
      note = results.isEmpty ? null : '최근 먹은 음식';
    } else {
      switch (index) {
        case AsyncData(:final value) when value.length == 0:
          results = const [];
          note = '음식 DB 가 아직 앱에 없어요. 직접 입력으로 남겨 주세요.';
        case AsyncData(:final value):
          results = value.search(_q);
          note = results.isEmpty ? '"$_q" 를 찾지 못했어요' : null;
        case AsyncError():
          results = const [];
          note = '음식 DB 를 읽지 못했어요. 직접 입력으로 남겨 주세요.';
        default:
          results = const [];
          note = '음식 DB 를 읽는 중';
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('음식 찾기')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.sm, Gap.xl, Gap.sm),
          child: TextField(
            autofocus: true,
            decoration: const InputDecoration(hintText: '예: 닭가슴살, 현미밥', prefixIcon: Icon(Icons.search)),
            onChanged: (v) => setState(() => _q = v),
          ),
        ),
        if (note != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Gap.xl, vertical: Gap.sm),
            child: Align(alignment: Alignment.centerLeft, child: Text(note, style: AppText.caption)),
          ),
        Expanded(
          child: ListView(children: [
            for (final f in results)
              ListTile(
                title: Text(f.label, style: AppText.body),
                subtitle: Text(
                    '100${f.unit} ${kcal(f.per100.kcal)} · 탄 ${grams(f.per100.carb)} 단 ${grams(f.per100.protein)} 지 ${grams(f.per100.fat)}',
                    style: AppText.caption),
                onTap: () async {
                  if (await showAmountSheet(context, ref, MealDraft.fromFood(f)) && context.mounted) context.pop();
                },
              ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('목록에 없으면 직접 입력'),
              onTap: () => context.pushReplacement('/diet/manual'),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.xl),
              child: Text('영양성분 출처: 식품의약품안전처 식품영양성분 데이터베이스', style: AppText.caption),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// 양·끼니를 정해 저장. 저장했으면 true.
Future<bool> showAmountSheet(BuildContext context, WidgetRef ref, MealDraft draft) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _AmountSheet(draft: draft),
  );
  return saved ?? false;
}

class _AmountSheet extends ConsumerStatefulWidget {
  const _AmountSheet({required this.draft});
  final MealDraft draft;

  @override
  ConsumerState<_AmountSheet> createState() => _AmountSheetState();
}

class _AmountSheetState extends ConsumerState<_AmountSheet> {
  late MealType _meal = MealType.at(ref.read(clockProvider)());
  late final _amount = TextEditingController(text: widget.draft.amount.round().toString());

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _step(double d) {
    final v = ((double.tryParse(_amount.text) ?? 0) + d).clamp(0, 5000).toDouble();
    _amount.text = v.round().toString();
    setState(() => widget.draft.amount = v);
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.draft;
    final n = d.nutrients;
    return Padding(
      padding: EdgeInsets.fromLTRB(Gap.xl, Gap.xl, Gap.xl, Gap.xl + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(d.name, style: AppText.section),
        const SizedBox(height: Gap.md),
        Row(children: [
          IconButton.outlined(onPressed: () => _step(-10), icon: const Icon(Icons.remove)),
          const SizedBox(width: Gap.sm),
          Expanded(
            child: TextField(
              controller: _amount,
              textAlign: TextAlign.center,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
              decoration: InputDecoration(suffixText: d.unit),
              onChanged: (v) => setState(() => d.amount = double.tryParse(v) ?? 0),
            ),
          ),
          const SizedBox(width: Gap.sm),
          IconButton.outlined(onPressed: () => _step(10), icon: const Icon(Icons.add)),
        ]),
        const SizedBox(height: Gap.sm),
        Text('${kcal(n.kcal)} · 탄 ${grams(n.carb)} 단 ${grams(n.protein)} 지 ${grams(n.fat)}', style: AppText.bodyStrong),
        const SizedBox(height: Gap.md),
        MealTypeChips(value: _meal, onChanged: (t) => setState(() => _meal = t)),
        const SizedBox(height: Gap.lg),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: d.amount <= 0
                ? null
                : () async {
                    await ref.read(mealsProvider.notifier).add([d.toEntry(ref.read(clockProvider)(), _meal, fromPhoto: false)]);
                    if (context.mounted) Navigator.pop(context, true);
                  },
            child: const Text('기록'),
          ),
        ),
      ]),
    );
  }
}

/// 이름과 열량(필수), 탄·단·지(선택)를 직접 적는다. 포장지 영양 표시를 옮겨 적는 경우.
class ManualMealScreen extends ConsumerStatefulWidget {
  const ManualMealScreen({super.key});

  @override
  ConsumerState<ManualMealScreen> createState() => _ManualMealScreenState();
}

class _ManualMealScreenState extends ConsumerState<ManualMealScreen> {
  final _name = TextEditingController();
  final _amount = TextEditingController();
  final _kcal = TextEditingController();
  final _carb = TextEditingController();
  final _protein = TextEditingController();
  final _fat = TextEditingController();
  late MealType _meal = MealType.at(ref.read(clockProvider)());
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _amount, _kcal, _carb, _protein, _fat]) {
      c.dispose();
    }
    super.dispose();
  }

  double _v(TextEditingController c) => double.tryParse(c.text.trim()) ?? 0;

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _v(_kcal) <= 0) {
      setState(() => _error = '음식 이름과 열량은 꼭 넣어 주세요');
      return;
    }
    await ref.read(mealsProvider.notifier).add([
      MealEntry(
        id: const Uuid().v4(),
        at: ref.read(clockProvider)(),
        meal: _meal,
        name: _name.text.trim(),
        amount: _v(_amount),
        nutrients: Nutrients(kcal: _v(_kcal), carb: _v(_carb), protein: _v(_protein), fat: _v(_fat)),
        source: MealSource.manual,
      ),
    ]);
    if (mounted) context.pop();
  }

  Widget _num(String label, TextEditingController c, String unit) => TextField(
        controller: c,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
        decoration: InputDecoration(labelText: label, suffixText: unit),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('직접 입력')),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
          children: [
            TextField(controller: _name, decoration: const InputDecoration(labelText: '음식 이름')),
            const SizedBox(height: Gap.md),
            Row(children: [
              Expanded(child: _num('먹은 양(선택)', _amount, 'g')),
              const SizedBox(width: Gap.md),
              Expanded(child: _num('열량', _kcal, 'kcal')),
            ]),
            const SizedBox(height: Gap.md),
            Row(children: [
              Expanded(child: _num('탄수화물', _carb, 'g')),
              const SizedBox(width: Gap.sm),
              Expanded(child: _num('단백질', _protein, 'g')),
              const SizedBox(width: Gap.sm),
              Expanded(child: _num('지방', _fat, 'g')),
            ]),
            const SizedBox(height: Gap.xs),
            Text('포장지의 영양 표시를 먹은 양 기준으로 옮겨 주세요. 양을 넣어 두면 다음에 최근 음식으로 다시 고를 수 있어요.',
                style: AppText.caption),
            const SizedBox(height: Gap.lg),
            MealTypeChips(value: _meal, onChanged: (t) => setState(() => _meal = t)),
            if (_error != null) ...[
              const SizedBox(height: Gap.md),
              Text(_error!, style: AppText.caption.copyWith(color: AppColors.coral)),
            ],
            const SizedBox(height: Gap.xl),
            FilledButton(onPressed: _save, child: const Text('기록')),
          ],
        ),
      );
}
