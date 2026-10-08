import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../machines/machine.dart';
import '../../machines/machines_state.dart';
import '../../machines/matcher.dart';
import '../widgets/panel.dart';

/// 기구 등록: 사진 2~3장 + 종류 + 종목(설계 §3).
///
/// 사진을 찍을 때마다 이미 있는 기구와 비교해, 같아 보이면 "기존 기구에 사진 추가"를
/// 먼저 권한다(중복 등록 방지). 공유되는 건 이름·종목·임베딩뿐이다(D1).
class RegisterMachineScreen extends ConsumerStatefulWidget {
  const RegisterMachineScreen({super.key});

  @override
  ConsumerState<RegisterMachineScreen> createState() => _RegisterMachineScreenState();
}

class _RegisterMachineScreenState extends ConsumerState<RegisterMachineScreen> {
  static const minPhotos = 2;
  static const maxPhotos = 3;

  final _name = TextEditingController();
  final _vectors = <List<double>>[];
  MachineKind _kind = MachineKind.machine;
  final _exerciseIds = <String>[];
  MachineScore? _duplicate;
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _snack(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _takePhoto() async {
    final path = await ref.read(photoSourceProvider).take();
    if (path == null) return;
    setState(() => _busy = true);
    try {
      final ctrl = ref.read(machinesProvider.notifier);
      final v = (await ctrl.embedAll([path])).single;
      _vectors.add(v);
      _duplicate = await ctrl.duplicateOf(_vectors);
    } catch (_) {
      _snack('사진을 읽지 못했어요. 다시 찍어 주세요.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addToExisting(Machine m) async {
    setState(() => _busy = true);
    await ref.read(machinesProvider.notifier).addPhotos(m, _vectors);
    if (!mounted) return;
    _snack('${m.name}에 사진 ${_vectors.length}장을 더했어요');
    Navigator.pop(context);
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    final m = await ref.read(machinesProvider.notifier).register(
          name: _name.text,
          kind: _kind,
          exerciseIds: List.of(_exerciseIds),
          vectors: _vectors,
        );
    if (!mounted) return;
    _snack('${m.name}을(를) 등록했어요');
    Navigator.pop(context);
  }

  bool get _canSave =>
      !_busy && _vectors.length >= minPhotos && _name.text.trim().isNotEmpty && _exerciseIds.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final options = exercisesFor(_kind);
    final dup = _duplicate;

    return Scaffold(
      appBar: AppBar(title: const Text('기구 등록')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const PanelLabel('사진'),
                Text('사진 ${_vectors.length}/$maxPhotos', style: AppText.section),
                const SizedBox(height: Gap.xs),
                const Text(
                  '기구 전체가 나오게, 사람은 나오지 않게 찍어 주세요. 서 있는 자리를 조금씩 바꿔 2~3장.',
                  style: AppText.caption,
                ),
                const SizedBox(height: Gap.md),
                OutlinedButton.icon(
                  onPressed: _busy || _vectors.length >= maxPhotos ? null : _takePhoto,
                  icon: _busy
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.photo_camera_outlined),
                  label: Text(_vectors.isEmpty ? '사진 찍기' : '한 장 더 찍기'),
                ),
              ],
            ),
          ),
          if (dup != null) ...[
            const SizedBox(height: Gap.md),
            Panel(
              color: AppColors.amberSoft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('이미 등록된 "${dup.machine.name}"와(과) 비슷해요', style: AppText.section),
                  const SizedBox(height: Gap.xs),
                  const Text('같은 기구라면 새로 등록하지 말고 사진만 더해 주세요. 매칭이 더 정확해져요.',
                      style: AppText.caption),
                  const SizedBox(height: Gap.md),
                  FilledButton(
                    onPressed: _busy ? null : () => _addToExisting(dup.machine),
                    child: Text('${dup.machine.name}에 사진 추가'),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: Gap.md),
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const PanelLabel('이름'),
                TextField(
                  controller: _name,
                  maxLength: 40,
                  decoration: const InputDecoration(hintText: '예: 레그 프레스(창가)'),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: Gap.sm),
                const PanelLabel('종류'),
                Wrap(
                  spacing: Gap.sm,
                  children: [
                    for (final k in MachineKind.values)
                      ChoiceChip(
                        label: Text(k.label),
                        selected: k == _kind,
                        onSelected: (_) => setState(() {
                          _kind = k;
                          final allowed = exercisesFor(k).map((e) => e.id).toSet();
                          _exerciseIds.removeWhere((id) => !allowed.contains(id));
                        }),
                      ),
                  ],
                ),
                const SizedBox(height: Gap.lg),
                const PanelLabel('이 기구로 하는 종목'),
                Wrap(
                  spacing: Gap.sm,
                  runSpacing: Gap.xs,
                  children: [
                    for (final e in options)
                      FilterChip(
                        label: Text(e.name),
                        selected: _exerciseIds.contains(e.id),
                        onSelected: (on) => setState(() => on ? _exerciseIds.add(e.id) : _exerciseIds.remove(e.id)),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: Gap.lg),
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: _canSave ? _save : null,
              child: Text(_vectors.length < minPhotos
                  ? '사진을 $minPhotos장 이상 찍어 주세요'
                  : (dup != null ? '다른 기구로 새로 등록' : '등록')),
            ),
          ),
        ],
      ),
    );
  }
}
