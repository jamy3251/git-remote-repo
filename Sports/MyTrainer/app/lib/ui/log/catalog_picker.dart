import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';

/// 카탈로그에서 종목 하나 고르기(기록 상태를 건드리지 않는다). 루틴 확인 화면에서 쓴다.
/// [suggestions] 는 맨 위에 "비슷한 종목"으로 보인다.
Future<Exercise?> pickCatalogExercise(BuildContext context, {List<Exercise> suggestions = const []}) =>
    showModalBottomSheet<Exercise>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _CatalogPicker(suggestions: suggestions),
    );

class _CatalogPicker extends StatefulWidget {
  const _CatalogPicker({required this.suggestions});

  final List<Exercise> suggestions;

  @override
  State<_CatalogPicker> createState() => _CatalogPickerState();
}

class _CatalogPickerState extends State<_CatalogPicker> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final q = _q.trim();
    final matches = exerciseCatalog.where((e) => q.isEmpty || e.name.contains(q)).toList();
    Widget tile(Exercise e) => ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(e.name, style: AppText.body),
          trailing: Text(e.group, style: AppText.micro.copyWith(color: AppColors.inkFaint)),
          onTap: () => Navigator.pop(context, e),
        );

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.lg, Gap.xl, Gap.huge),
        children: [
          TextField(
            decoration: const InputDecoration(hintText: '종목 찾기', prefixIcon: Icon(Icons.search)),
            onChanged: (v) => setState(() => _q = v),
          ),
          if (q.isEmpty && widget.suggestions.isNotEmpty) ...[
            const SizedBox(height: Gap.lg),
            Text('비슷한 종목', style: AppText.labelStrong.copyWith(color: AppColors.inkSub)),
            for (final e in widget.suggestions) tile(e),
            const Divider(),
          ],
          for (final e in matches) tile(e),
        ],
      ),
    );
  }
}
