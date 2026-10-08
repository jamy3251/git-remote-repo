import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme.dart';
import '../../routines/extract_spec.dart';
import '../../routines/routine_extractor.dart';
import '../../routines/routines_state.dart';
import '../log/catalog_picker.dart';
import '../widgets/panel.dart';

/// 영상 → 루틴(설계 D10): 유튜브 링크나 영상 파일 → AI 추출 → 종목 연결 확인·수정 → 저장.
/// 영상 본문은 저장하지 않는다. 링크만 출처로 남긴다.
class ImportRoutineScreen extends ConsumerStatefulWidget {
  const ImportRoutineScreen({super.key});

  @override
  ConsumerState<ImportRoutineScreen> createState() => _ImportRoutineScreenState();
}

class _ImportRoutineScreenState extends ConsumerState<ImportRoutineScreen> {
  final _url = TextEditingController();
  RoutineDraft? _draft;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _run(VideoInput input, {String? sourceUrl}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref.read(routineExtractorProvider).extract(input);
      setState(() => _draft = RoutineDraft.from(r, ref.read(exerciseLinkerProvider), sourceUrl: sourceUrl));
    } on ExtractError catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '루틴을 뽑지 못했어요: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _fromLink() async {
    final url = _url.text.trim();
    if (!isYoutubeUrl(url)) {
      setState(() => _error = '유튜브 영상 주소를 넣어 주세요(공개 또는 일부 공개 영상)');
      return;
    }
    await _run(YoutubeInput(url), sourceUrl: url);
  }

  Future<void> _fromFile() async {
    final x = await ImagePicker().pickVideo(source: ImageSource.gallery);
    if (x == null) return;
    final ext = x.path.split('.').last.toLowerCase();
    final mime = switch (ext) { 'mov' => 'video/quicktime', 'webm' => 'video/webm', '3gp' => 'video/3gpp', _ => 'video/mp4' };
    await _run(FileInput(x.path, mimeType: mime));
  }

  Future<void> _save() async {
    final routine = _draft!.toRoutine();
    await ref.read(routinesProvider.notifier).save(routine);
    await ref.read(activeRoutineIdProvider.notifier).set(routine.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${routine.name}을(를) 저장했어요')));
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final available = ref.watch(routineExtractorProvider).available;
    final draft = _draft;
    return Scaffold(
      appBar: AppBar(title: const Text('영상에서 루틴 가져오기')),
      body: draft != null
          ? _DraftEditor(draft: draft, onChanged: () => setState(() {}), onSave: _save)
          : ListView(
              padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
              children: [
                if (!available)
                  const Panel(
                    color: AppColors.amberSoft,
                    child: Text('영상 루틴 가져오기는 서버에 연결된 상태에서만 돼요.', style: AppText.body),
                  ),
                Panel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const PanelLabel('유튜브 링크'),
                      TextField(
                        controller: _url,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(hintText: 'https://youtube.com/...'),
                      ),
                      const SizedBox(height: Gap.md),
                      FilledButton(
                        onPressed: _busy || !available ? null : _fromLink,
                        child: const Text('루틴 뽑기'),
                      ),
                      const SizedBox(height: Gap.sm),
                      OutlinedButton.icon(
                        onPressed: _busy || !available ? null : _fromFile,
                        icon: const Icon(Icons.video_library_outlined),
                        label: const Text('폰에 있는 영상으로(20MB 까지)'),
                      ),
                    ],
                  ),
                ),
                if (_busy)
                  const Padding(
                    padding: EdgeInsets.all(Gap.xl),
                    child: Column(children: [
                      CircularProgressIndicator(),
                      SizedBox(height: Gap.md),
                      Text('영상을 보고 있어요. 길면 1분쯤 걸려요.', style: AppText.caption),
                    ]),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: Gap.md),
                    child: Text(_error!, style: AppText.body.copyWith(color: AppColors.coral)),
                  ),
                const SizedBox(height: Gap.md),
                const Text('영상에 나온 종목·세트·횟수만 가져와요. 무게는 영상에 숫자로 나온 경우만 넣어요.',
                    style: AppText.caption),
              ],
            ),
    );
  }
}

class _DraftEditor extends StatelessWidget {
  const _DraftEditor({required this.draft, required this.onChanged, required this.onSave});

  final RoutineDraft draft;
  final VoidCallback onChanged;
  final Future<void> Function() onSave;

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          TextFormField(
            initialValue: draft.name,
            style: AppText.title,
            decoration: const InputDecoration(labelText: '루틴 이름'),
            onChanged: (v) => draft.name = v,
          ),
          const SizedBox(height: Gap.sm),
          Text(
            draft.unlinked == 0
                ? '종목 ${draft.items.length}개. 맞는지 보고 저장해 주세요.'
                : '종목 ${draft.unlinked}개를 앱 목록에서 골라 주세요.',
            style: AppText.caption,
          ),
          const SizedBox(height: Gap.md),
          for (final (i, item) in draft.items.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: Gap.sm),
              child: _DraftRow(
                index: i,
                item: item,
                onChanged: onChanged,
                onRemove: () {
                  draft.items.removeAt(i);
                  onChanged();
                },
              ),
            ),
          const SizedBox(height: Gap.md),
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: draft.ready ? onSave : null,
              child: Text(draft.ready ? '저장하고 오늘 루틴으로' : '종목을 모두 골라 주세요'),
            ),
          ),
        ],
      );
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.index, required this.item, required this.onChanged, required this.onRemove});

  final int index;
  final DraftItem item;
  final VoidCallback onChanged;
  final VoidCallback onRemove;

  Widget _count(String label, int value, ValueChanged<int> set) => Row(mainAxisSize: MainAxisSize.min, children: [
        Text(label, style: AppText.caption),
        IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: () => set((value - 1).clamp(1, 100)),
            icon: const Icon(Icons.remove, size: 18)),
        Text('$value', style: AppText.bodyStrong),
        IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: () => set((value + 1).clamp(1, 100)),
            icon: const Icon(Icons.add, size: 18)),
      ]);

  @override
  Widget build(BuildContext context) {
    final ex = item.exercise;
    final guessed = [if (item.setsGuessed) '세트', if (item.repsGuessed) '횟수'];
    return Panel(
      color: ex == null ? AppColors.amberSoft : null,
      padding: const EdgeInsets.all(Gap.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: InkWell(
                key: Key('draft-exercise-$index'),
                onTap: () async {
                  final picked = await pickCatalogExercise(context, suggestions: item.link.candidates);
                  if (picked != null) {
                    item.choose(picked);
                    onChanged();
                  }
                },
                child: Text(
                  ex == null ? '종목 고르기' : '${ex.name} · ${(item.variant ?? ex.variants.first).label}',
                  style: AppText.section.copyWith(color: ex == null ? AppColors.coral : AppColors.ink),
                ),
              ),
            ),
            IconButton(tooltip: '빼기', onPressed: onRemove, icon: const Icon(Icons.close, size: 20)),
          ]),
          Text('영상: ${item.source.name}${item.source.weightKg == null ? '' : ' · ${item.source.weightKg}kg'}',
              style: AppText.micro.copyWith(color: AppColors.inkFaint)),
          Wrap(children: [
            _count('세트', item.sets, (v) {
              item.sets = v;
              item.setsGuessed = false;
              onChanged();
            }),
            _count('횟수', item.repsMin, (v) {
              final range = item.repsMax - item.repsMin;
              item.repsMin = v;
              item.repsMax = v + range;
              item.repsGuessed = false;
              onChanged();
            }),
            if (item.repsMax != item.repsMin)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text('~${item.repsMax}회', style: AppText.caption),
              ),
          ]),
          if (guessed.isNotEmpty)
            Text('영상에 ${guessed.join('·')} 수가 없어 기본값을 넣었어요',
                style: AppText.micro.copyWith(color: AppColors.amber)),
        ],
      ),
    );
  }
}
