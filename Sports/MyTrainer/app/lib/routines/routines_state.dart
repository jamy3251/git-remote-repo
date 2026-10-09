import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../data/exercises.dart';
import '../state/attendance.dart';
import 'exercise_linker.dart';
import 'extract_spec.dart';
import 'routine.dart';
import 'routine_extractor.dart';
import 'routine_repository.dart';

// main 에서 실제 값으로 덮어쓴다.
final routineRepositoryProvider =
    Provider<RoutineRepository>((ref) => LocalRoutineRepository(ref.watch(sharedPreferencesProvider)));
final routineExtractorProvider = Provider<RoutineExtractor>((_) => UnavailableExtractor());
final exerciseLinkerProvider = Provider((_) => const ExerciseLinker());

/// 확인 화면에서 고치는 한 줄. 영상에 없던 값은 기본값으로 채우고 표시한다.
class DraftItem {
  DraftItem({
    required this.source,
    required this.link,
    required this.exercise,
    required this.variant,
    required this.sets,
    required this.repsMin,
    required this.repsMax,
    required this.setsGuessed,
    required this.repsGuessed,
  });

  /// 기본값: 세트·횟수가 영상에 없으면 3세트 10회.
  static const defaultSets = 3;
  static const defaultReps = 10;

  final ExtractedExercise source;
  final LinkResult link;
  Exercise? exercise;
  Variant? variant;
  int sets;
  int repsMin;
  int repsMax;
  bool setsGuessed;
  bool repsGuessed;

  factory DraftItem.from(ExtractedExercise e, ExerciseLinker linker) {
    final link = linker.link(e.name, nameEnglish: e.nameEnglish, equipment: e.equipment);
    return DraftItem(
      source: e,
      link: link,
      exercise: link.exercise,
      variant: link.variant,
      sets: e.sets ?? defaultSets,
      repsMin: e.repsMin ?? defaultReps,
      repsMax: e.repsMax ?? e.repsMin ?? defaultReps,
      setsGuessed: e.sets == null,
      repsGuessed: e.repsMin == null,
    );
  }

  /// 종목을 직접 고르면 영상의 기구 힌트를 다시 적용한다.
  void choose(Exercise ex) {
    exercise = ex;
    variant = ExerciseLinker.variantFor(ex, link.variant);
  }

  RoutineItem toItem() => RoutineItem(
        exerciseId: exercise!.id,
        variant: variant ?? exercise!.variants.first,
        sets: sets,
        repsMin: repsMin,
        repsMax: repsMax < repsMin ? repsMin : repsMax,
        restSec: source.restSeconds,
        weightKg: source.weightKg,
        note: source.note,
      );
}

class RoutineDraft {
  RoutineDraft({required this.name, required this.items, this.sourceUrl});

  factory RoutineDraft.from(ExtractedRoutine r, ExerciseLinker linker, {String? sourceUrl}) => RoutineDraft(
        name: (r.title?.trim().isNotEmpty ?? false) ? r.title!.trim() : '영상 루틴',
        items: [for (final e in r.exercises) DraftItem.from(e, linker)],
        sourceUrl: sourceUrl,
      );

  String name;
  final List<DraftItem> items;
  final String? sourceUrl;

  bool get ready => items.isNotEmpty && items.every((i) => i.exercise != null);

  int get unlinked => items.where((i) => i.exercise == null).length;

  Routine toRoutine() => Routine(
        id: const Uuid().v4(),
        name: name.trim().isEmpty ? '영상 루틴' : name.trim(),
        items: [for (final i in items) i.toItem()],
        createdAt: DateTime.now(),
        sourceUrl: sourceUrl,
      );
}

final routinesProvider =
    AsyncNotifierProvider<RoutinesController, List<Routine>>(RoutinesController.new);

class RoutinesController extends AsyncNotifier<List<Routine>> {
  RoutineRepository get _repo => ref.read(routineRepositoryProvider);

  @override
  Future<List<Routine>> build() async =>
      (await _repo.routines())..sort((a, b) => b.createdAt.compareTo(a.createdAt));

  Future<void> save(Routine r) async {
    await _repo.save(r);
    ref.invalidateSelf();
    await future;
  }

  Future<void> delete(Routine r) async {
    await _repo.delete(r.id);
    if (ref.read(activeRoutineIdProvider) == r.id) await ref.read(activeRoutineIdProvider.notifier).set(null);
    ref.invalidateSelf();
    await future;
  }
}

/// 기록 화면에 띄울 루틴. 바꿀 때까지 유지한다.
final activeRoutineIdProvider = NotifierProvider<ActiveRoutineId, String?>(ActiveRoutineId.new);

class ActiveRoutineId extends Notifier<String?> {
  static const _key = 'mytrainer.routine.active';

  @override
  String? build() => ref.watch(sharedPreferencesProvider).getString(_key);

  Future<void> set(String? id) async {
    final prefs = ref.read(sharedPreferencesProvider);
    if (id == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, id);
    }
    state = id;
  }
}

final activeRoutineProvider = Provider<Routine?>((ref) {
  final id = ref.watch(activeRoutineIdProvider);
  final all = ref.watch(routinesProvider).valueOrNull ?? const [];
  return id == null ? null : all.where((r) => r.id == id).firstOrNull;
});
