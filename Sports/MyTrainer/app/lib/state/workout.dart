import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../data/exercises.dart';
import '../data/workout.dart';
import '../services/location_access.dart';
import '../services/logging_rules.dart';
import 'attendance.dart';

final loggingRulesProvider = Provider((_) => const LoggingRules());

/// 기록 화면 상태.
///
/// 입력칸은 항상 미리 채워져 있고, 보통 세트는 "같은 세트 기록" 한 번으로 끝난다.
/// 탭 수와 첫 조작부터 저장까지의 시간을 세트마다 남긴다(기록 마찰 지표).
class WorkoutState {
  const WorkoutState({
    required this.history,
    required this.exercise,
    required this.variant,
    required this.weightKg,
    required this.reps,
    required this.prefillSource,
    this.pendingTaps = 0,
    this.firstTouch,
    this.pickMethod,
    this.pickMs,
  });

  /// 1RM 추이용으로 넉넉히 읽은 기록.
  final List<WorkoutSet> history;
  final Exercise? exercise;
  final Variant? variant;
  final double weightKg;
  final int reps;
  final PrefillSource prefillSource;

  /// 저장 전까지 누른 조정 횟수.
  final int pendingTaps;
  final DateTime? firstTouch;

  /// 고른 뒤 첫 세트에 붙일 고르기 방법·시간. 첫 세트를 저장하면 비운다.
  final String? pickMethod;
  final int? pickMs;

  String? get key => exercise == null ? null : '${exercise!.id}|${variant!.key}';

  WorkoutState copyWith({
    List<WorkoutSet>? history,
    Exercise? exercise,
    Variant? variant,
    double? weightKg,
    int? reps,
    PrefillSource? prefillSource,
    int? pendingTaps,
    DateTime? firstTouch,
    bool clearTouch = false,
    String? pickMethod,
    int? pickMs,
    bool clearPick = false,
  }) =>
      WorkoutState(
        history: history ?? this.history,
        exercise: exercise ?? this.exercise,
        variant: variant ?? this.variant,
        weightKg: weightKg ?? this.weightKg,
        reps: reps ?? this.reps,
        prefillSource: prefillSource ?? this.prefillSource,
        pendingTaps: pendingTaps ?? this.pendingTaps,
        firstTouch: clearTouch ? null : (firstTouch ?? this.firstTouch),
        pickMethod: clearPick ? null : (pickMethod ?? this.pickMethod),
        pickMs: clearPick ? null : (pickMs ?? this.pickMs),
      );
}

final workoutProvider =
    AsyncNotifierProvider<WorkoutController, WorkoutState>(WorkoutController.new);

class WorkoutController extends AsyncNotifier<WorkoutState> {
  /// 1RM 추이를 보려고 반년치를 읽는다. 주 4회 x 20세트여도 2천 건 남짓.
  static const historyWindow = Duration(days: 180);

  LoggingRules get _rules => ref.read(loggingRulesProvider);

  @override
  Future<WorkoutState> build() async {
    final history = await ref
        .read(repositoryProvider)
        .sets(since: DateTime.now().subtract(historyWindow));
    final recent = _rules.recent(history, limit: 1);
    final base = WorkoutState(
      history: history,
      exercise: null,
      variant: null,
      weightKg: 0,
      reps: 10,
      prefillSource: PrefillSource.none,
    );
    if (recent.isEmpty) return base;
    final r = recent.first;
    final ex = exerciseById(r.exerciseId);
    return ex == null ? base : _withPrefill(base, ex, r.variant);
  }

  WorkoutState _withPrefill(WorkoutState s, Exercise ex, Variant v) {
    final p = _rules.prefill(s.history, ex.id, v, DateTime.now());
    return s.copyWith(
      exercise: ex,
      variant: v,
      weightKg: p.weightKg,
      reps: p.reps,
      prefillSource: p.source,
      pendingTaps: 0,
      clearTouch: true,
    );
  }

  DateTime? _pickStart;

  /// 목록·카메라를 연 순간. [selectExercise] 에서 걸린 시간을 잰다.
  /// 사진으로 찾다가 목록으로 넘어가도 처음 연 시각을 유지한다(수정 포함 시간, D15).
  void startPick() => _pickStart ??= DateTime.now();

  /// 종목만 고르면 마지막으로 쓴 기구가 따라온다.
  void selectExercise(Exercise ex, {Variant? variant, String method = 'list'}) {
    final s = state.valueOrNull;
    if (s == null) return;
    final ms = _pickStart == null ? null : DateTime.now().difference(_pickStart!).inMilliseconds;
    _pickStart = null;
    state = AsyncData(_withPrefill(s, ex, variant ?? _rules.defaultVariant(s.history, ex))
        .copyWith(pickMethod: method, pickMs: ms));
  }

  /// 루틴 한 줄로 시작. 무게는 내 지난 기록이 우선, 없으면 영상에 나온 무게.
  /// 횟수는 오늘 이미 한 세트가 있으면 그대로, 아니면 루틴 목표(범위면 아래쪽부터, 이중 진행법).
  void selectFromRoutine(Exercise ex, Variant variant, {required int targetReps, double? weightKg}) {
    selectExercise(ex, variant: variant, method: 'routine');
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncData(s.copyWith(
      reps: s.prefillSource == PrefillSource.previousSet ? s.reps : targetReps,
      weightKg: s.prefillSource == PrefillSource.none && weightKg != null ? weightKg : s.weightKg,
    ));
  }

  /// 고르기를 취소했으면 시간을 버린다.
  void cancelPick() => _pickStart = null;

  void selectVariant(Variant v) {
    final s = state.valueOrNull;
    if (s == null || s.exercise == null) return;
    state = AsyncData(_withPrefill(s, s.exercise!, v));
  }

  void _touch(WorkoutState Function(WorkoutState) change) {
    final s = state.valueOrNull;
    if (s == null) return;
    final t = change(s);
    state = AsyncData(t.copyWith(
      pendingTaps: s.pendingTaps + 1,
      firstTouch: s.firstTouch ?? DateTime.now(),
    ));
  }

  void adjustWeight(double delta) =>
      _touch((s) => s.copyWith(weightKg: (s.weightKg + delta).clamp(0, 500).toDouble()));

  void adjustReps(int delta) => _touch((s) => s.copyWith(reps: (s.reps + delta).clamp(1, 50)));

  void setWeight(double kg) => _touch((s) => s.copyWith(weightKg: kg.clamp(0, 500).toDouble()));

  /// 세트 저장. [failedAtRep] 이 있으면 그 회차에서 무너진 것, 해낸 횟수는 그 앞까지.
  Future<WorkoutSet?> logSet({int? failedAtRep}) async {
    final s = state.valueOrNull;
    if (s == null || s.exercise == null) return null;
    final now = DateTime.now();
    final attendance = ref.read(attendanceProvider).valueOrNull;
    final set = WorkoutSet(
      id: const Uuid().v4(),
      at: now,
      exerciseId: s.exercise!.id,
      variant: s.variant!,
      weightKg: s.weightKg,
      reps: failedAtRep == null ? s.reps : failedAtRep - 1,
      failedAtRep: failedAtRep,
      insideFence: await isInsideGym(attendance?.gym),
      taps: s.pendingTaps + 1 + (failedAtRep == null ? 0 : 1),
      entryMs: s.firstTouch == null ? null : now.difference(s.firstTouch!).inMilliseconds,
      pickMethod: s.pickMethod,
      pickMs: s.pickMs,
    );
    await ref.read(repositoryProvider).saveSet(set);

    final history = [...s.history, set];
    state = AsyncData(
        _withPrefill(s.copyWith(history: history, clearPick: true), s.exercise!, s.variant!));
    await ref.read(attendanceProvider.notifier).reload();
    return set;
  }

  /// 스포터 결과를 확인해 저장한다. 세트 시각은 실제로 든 시각(촬영 시각).
  Future<WorkoutSet> logSpotted({
    required Exercise exercise,
    required Variant variant,
    required double weightKg,
    required int reps,
    required DateTime at,
    required String spotId,
    String? spottedBy,
  }) async {
    final s = state.valueOrNull ?? await future;
    final set = WorkoutSet(
      id: const Uuid().v4(),
      at: at,
      exerciseId: exercise.id,
      variant: variant,
      weightKg: weightKg,
      reps: reps,
      spotId: spotId,
      spottedBy: spottedBy,
    );
    await ref.read(repositoryProvider).saveSet(set);
    state = AsyncData(s.copyWith(history: [...s.history, set]));
    await ref.read(attendanceProvider.notifier).reload();
    return set;
  }

  Future<void> deleteSet(String id) async {
    final s = state.valueOrNull;
    if (s == null) return;
    await ref.read(repositoryProvider).deleteSet(id);
    final history = s.history.where((x) => x.id != id).toList();
    final next = s.copyWith(history: history);
    state = AsyncData(s.exercise == null ? next : _withPrefill(next, s.exercise!, s.variant!));
    await ref.read(attendanceProvider.notifier).reload();
  }
}
