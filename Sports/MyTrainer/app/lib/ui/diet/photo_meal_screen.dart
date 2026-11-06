import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../diet/diet_state.dart';
import '../../diet/food.dart' show FoodIndex;
import '../../diet/food_db.dart';
import '../../diet/food_photo.dart';
import '../../diet/meal.dart';
import '../../diet/meal_draft.dart';
import '../widgets/panel.dart';
import 'diet_screen.dart';

/// 음식 사진 한 장 → 음식별 줄 → 양을 고쳐 저장. 사진은 저장하지 않는다.
class PhotoMealScreen extends ConsumerStatefulWidget {
  const PhotoMealScreen({super.key});

  @override
  ConsumerState<PhotoMealScreen> createState() => _PhotoMealScreenState();
}

class _PhotoMealScreenState extends ConsumerState<PhotoMealScreen> {
  List<MealDraft>? _drafts;
  bool _busy = false;
  String? _error;
  late MealType _meal = MealType.at(ref.read(clockProvider)());

  Future<void> _take(bool camera) async {
    final bytes = await ref.read(mealPhotoSourceProvider).take(camera: camera);
    if (bytes == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final found = await ref.read(foodPhotoAnalyzerProvider).analyze(bytes);
      FoodIndex? index;
      try {
        index = await ref.read(foodIndexProvider.future);
      } catch (_) {
        index = null; // DB 를 못 읽으면 AI 값으로
      }
      if (!mounted) return;
      setState(() => _drafts = [for (final p in found) resolvePhotoFood(p, index)]);
    } on FoodPhotoError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final now = ref.read(clockProvider)();
    final keep = _drafts!.where((d) => !d.skip && d.amount > 0).toList();
    await ref.read(mealsProvider.notifier).add([for (final d in keep) d.toEntry(now, _meal, fromPhoto: true)]);
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final drafts = _drafts;
    return Scaffold(
      appBar: AppBar(title: const Text('사진으로 기록')),
      body: _busy
          ? const Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                CircularProgressIndicator(),
                SizedBox(height: Gap.md),
                Text('음식을 알아보는 중', style: AppText.body),
              ]),
            )
          : drafts == null
              ? _Pick(onTake: _take, error: _error)
              : ListView(
                  padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
                  children: [
                    Text('양이 맞는지 확인해 주세요', style: AppText.title),
                    const SizedBox(height: Gap.xs),
                    Text('DB 표시는 식약처 값으로, AI 추정은 사진만 보고 짐작한 값이에요.', style: AppText.caption),
                    const SizedBox(height: Gap.md),
                    for (final d in drafts) _DraftRow(draft: d, onChanged: () => setState(() {})),
                    const SizedBox(height: Gap.md),
                    MealTypeChips(value: _meal, onChanged: (t) => setState(() => _meal = t)),
                    const SizedBox(height: Gap.lg),
                    FilledButton(
                      onPressed: drafts.any((d) => !d.skip && d.amount > 0) ? _save : null,
                      child: Text(
                          '${drafts.where((d) => !d.skip).length}개 기록 · ${kcal(drafts.where((d) => !d.skip).fold(0.0, (a, d) => a + d.nutrients.kcal))}'),
                    ),
                    TextButton(onPressed: () => setState(() => _drafts = null), child: const Text('다시 찍기')),
                  ],
                ),
    );
  }
}

class _Pick extends StatelessWidget {
  const _Pick({required this.onTake, required this.error});

  final void Function(bool camera) onTake;
  final String? error;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(Gap.xl),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisAlignment: MainAxisAlignment.center, children: [
          const Text('먹기 전에 위에서 한 장 찍어 주세요', style: AppText.title, textAlign: TextAlign.center),
          const SizedBox(height: Gap.xs),
          Text('그릇이 다 보이게 찍으면 양 짐작이 나아요.', style: AppText.caption, textAlign: TextAlign.center),
          if (error != null) ...[
            const SizedBox(height: Gap.lg),
            Panel(
              color: AppColors.coralSoft,
              padding: const EdgeInsets.all(Gap.lg),
              child: Text(error!, style: AppText.body),
            ),
          ],
          const SizedBox(height: Gap.xl),
          FilledButton.icon(
            onPressed: () => onTake(true),
            icon: const Icon(Icons.photo_camera_outlined),
            label: const Text('찍기'),
          ),
          const SizedBox(height: Gap.sm),
          OutlinedButton.icon(
            onPressed: () => onTake(false),
            icon: const Icon(Icons.photo_library_outlined),
            label: const Text('앨범에서 고르기'),
          ),
          TextButton(onPressed: () => context.pushReplacement('/diet/search'), child: const Text('이름으로 찾기')),
        ]),
      );
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.draft, required this.onChanged});

  final MealDraft draft;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final d = draft;
    final n = d.nutrients;
    void step(double v) {
      d.amount = (d.amount + v).clamp(0, 3000).toDouble();
      onChanged();
    }

    return Opacity(
      opacity: d.skip ? 0.4 : 1,
      child: Padding(
        padding: const EdgeInsets.only(bottom: Gap.sm),
        child: Panel(
          padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.md, Gap.sm, Gap.md),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(d.name, style: AppText.bodyStrong, overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: Gap.sm),
                  _Tag(d.fromDb ? 'DB' : 'AI 추정', d.fromDb ? AppColors.tealSoft : AppColors.amberSoft),
                ]),
                Text('${kcal(n.kcal)} · 탄 ${grams(n.carb)} 단 ${grams(n.protein)} 지 ${grams(n.fat)}', style: AppText.caption),
              ]),
            ),
            IconButton(onPressed: d.skip ? null : () => step(-10), icon: const Icon(Icons.remove, size: 18)),
            SizedBox(
              width: 52,
              child: Text('${d.amount.round()}${d.unit}', style: AppText.label, textAlign: TextAlign.center),
            ),
            IconButton(onPressed: d.skip ? null : () => step(10), icon: const Icon(Icons.add, size: 18)),
            IconButton(
              tooltip: d.skip ? '다시 넣기' : '빼기',
              onPressed: () {
                d.skip = !d.skip;
                onChanged();
              },
              icon: Icon(d.skip ? Icons.undo : Icons.close, size: 18, color: AppColors.inkFaint),
            ),
          ]),
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.sm, vertical: 2),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(Radii.small)),
        child: Text(text, style: AppText.micro.copyWith(color: AppColors.ink)),
      );
}
