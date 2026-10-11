import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../diet/body_profile.dart';
import '../../diet/diet_state.dart';

/// 몸 정보. 하루 목표와 추천 운동 횟수 범위(목표)에 쓴다.
class BodyProfileScreen extends ConsumerStatefulWidget {
  const BodyProfileScreen({super.key});

  @override
  ConsumerState<BodyProfileScreen> createState() => _BodyProfileScreenState();
}

class _BodyProfileScreenState extends ConsumerState<BodyProfileScreen> {
  late final BodyProfile? _old = ref.read(bodyProfileProvider).valueOrNull;
  late Sex _sex = _old?.sex ?? Sex.male;
  late Activity _activity = _old?.activity ?? Activity.moderate;
  late Goal _goal = _old?.goal ?? Goal.maintain;
  late final _year = TextEditingController(text: _old?.birthYear.toString() ?? '');
  late final _height = TextEditingController(text: _old == null ? '' : _num(_old.heightCm));
  late final _weight = TextEditingController(text: _old == null ? '' : _num(_old.weightKg));
  String? _error;

  static String _num(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  void dispose() {
    _year.dispose();
    _height.dispose();
    _weight.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final now = ref.read(clockProvider)();
    final year = int.tryParse(_year.text.trim());
    final h = double.tryParse(_height.text.trim());
    final w = double.tryParse(_weight.text.trim());
    final String? err;
    if (year == null || now.year - year < 14 || now.year - year > 90) {
      err = '출생연도를 확인해 주세요(만 14~90세)';
    } else if (h == null || h < 120 || h > 230) {
      err = '키를 cm 로 넣어 주세요';
    } else if (w == null || w < 30 || w > 250) {
      err = '몸무게를 kg 로 넣어 주세요';
    } else {
      err = null;
    }
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    await ref.read(bodyProfileProvider.notifier).save(BodyProfile(
          sex: _sex,
          birthYear: year!,
          heightCm: h!,
          weightKg: w!,
          activity: _activity,
          goal: _goal,
        ));
    if (mounted) context.pop();
  }

  Widget _field(String label, TextEditingController c, String suffix, {bool decimal = false}) => TextField(
        controller: c,
        keyboardType: TextInputType.numberWithOptions(decimal: decimal),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(decimal ? r'[\d.]' : r'\d'))],
        decoration: InputDecoration(labelText: label, suffixText: suffix),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('몸 정보')),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
          children: [
            const Text('성별', style: AppText.labelStrong),
            const SizedBox(height: Gap.sm),
            SegmentedButton<Sex>(
              segments: const [
                ButtonSegment(value: Sex.male, label: Text('남')),
                ButtonSegment(value: Sex.female, label: Text('여')),
              ],
              selected: {_sex},
              onSelectionChanged: (s) => setState(() => _sex = s.first),
            ),
            const SizedBox(height: Gap.lg),
            _field('출생연도', _year, '년'),
            const SizedBox(height: Gap.md),
            Row(children: [
              Expanded(child: _field('키', _height, 'cm', decimal: true)),
              const SizedBox(width: Gap.md),
              Expanded(child: _field('몸무게', _weight, 'kg', decimal: true)),
            ]),
            const SizedBox(height: Gap.xl),
            const Text('평소 활동량', style: AppText.labelStrong),
            const SizedBox(height: Gap.sm),
            for (final a in Activity.values)
              RadioListTile<Activity>(
                contentPadding: EdgeInsets.zero,
                value: a,
                groupValue: _activity,
                onChanged: (v) => setState(() => _activity = v!),
                title: Text(a.label, style: AppText.body),
                subtitle: Text(a.hint, style: AppText.caption),
              ),
            const SizedBox(height: Gap.md),
            const Text('목표', style: AppText.labelStrong),
            const SizedBox(height: Gap.sm),
            SegmentedButton<Goal>(
              segments: [for (final g in Goal.values) ButtonSegment(value: g, label: Text(g.label))],
              selected: {_goal},
              onSelectionChanged: (s) => setState(() => _goal = s.first),
            ),
            const SizedBox(height: Gap.xs),
            Text('증량이면 추천 운동이 6~10회, 그 밖에는 8~12회 범위로 잡혀요.', style: AppText.caption),
            if (_error != null) ...[
              const SizedBox(height: Gap.md),
              Text(_error!, style: AppText.caption.copyWith(color: AppColors.coral)),
            ],
            const SizedBox(height: Gap.xl),
            FilledButton(onPressed: _save, child: const Text('저장')),
          ],
        ),
      );
}
