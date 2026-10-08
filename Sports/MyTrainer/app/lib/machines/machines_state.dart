import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../data/exercises.dart';
import '../data/workout.dart';
import 'embedder.dart';
import 'machine.dart';
import 'machine_repository.dart';
import 'matcher.dart';

// main 에서 실제 저장소로 덮어쓴다. 테스트·Firebase 없는 실행은 로컬.
final machineRepositoryProvider = Provider<MachineRepository>((_) => throw UnimplementedError());
final embedderProvider = Provider<Embedder>((_) => const MediaPipeEmbedder());
final photoSourceProvider = Provider<PhotoSource>((_) => const CameraPhotoSource());
final matcherProvider =
    Provider((ref) => MachineMatcher(modelId: ref.watch(embedderProvider).modelId));

/// 사진 찍기. 테스트에서 바꿔 끼운다.
abstract class PhotoSource {
  /// 찍은 사진 경로. 취소하면 null.
  Future<String?> take();
}

class CameraPhotoSource implements PhotoSource {
  const CameraPhotoSource();

  @override
  Future<String?> take() async {
    // 임베딩은 640px 로 줄여 쓰므로 크게 찍을 필요가 없다.
    final x = await ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: 1280,
      maxHeight: 1280,
      imageQuality: 85,
    );
    return x?.path;
  }
}

class MachinesState {
  const MachinesState({required this.machines, required this.photos});

  final List<Machine> machines;
  final List<MachinePhoto> photos;

  int photoCount(String machineId) => photos.where((p) => p.machineId == machineId).length;

  /// 지금 모델과 맞는 사진이 하나도 없는 기구(D16: 사진 다시 찍기 필요).
  bool needsRephoto(String machineId, String modelId) =>
      !photos.any((p) => p.machineId == machineId && p.modelId == modelId);

  Machine? byGroup(String groupId) => machines.where((m) => m.groupId == groupId).firstOrNull;
}

final machinesProvider =
    AsyncNotifierProvider<MachinesController, MachinesState>(MachinesController.new);

class MachinesController extends AsyncNotifier<MachinesState> {
  MachineRepository get _repo => ref.read(machineRepositoryProvider);

  @override
  Future<MachinesState> build() => _load();

  Future<MachinesState> _load() async =>
      MachinesState(machines: await _repo.machines(), photos: await _repo.photos());

  Future<void> reload() async => state = await AsyncValue.guard(_load);

  /// 사진 경로들을 임베딩한다. 등록·추가·찾기 모두 이것을 거친다.
  Future<List<List<double>>> embedAll(List<String> paths) async {
    final e = ref.read(embedderProvider);
    return [for (final p in paths) await e.embed(p)];
  }

  List<MachinePhoto> _photos(String machineId, List<List<double>> vectors) {
    final now = DateTime.now();
    final modelId = ref.read(embedderProvider).modelId;
    return [
      for (final v in vectors)
        MachinePhoto(
          id: const Uuid().v4(),
          machineId: machineId,
          modelId: modelId,
          vector: v,
          createdBy: _repo.me,
          createdAt: now,
        ),
    ];
  }

  /// 등록 전에: 이미 있는 기구와 같아 보이면 그 기구.
  Future<MachineScore?> duplicateOf(List<List<double>> vectors) async {
    // 등록 화면은 목록을 보지 않으니 아직 안 읽었을 수 있다.
    final s = state.valueOrNull ?? await future;
    return ref.read(matcherProvider).duplicateOf(vectors, s.machines, s.photos);
  }

  Future<Machine> register({
    required String name,
    required MachineKind kind,
    required List<String> exerciseIds,
    required List<List<double>> vectors,
  }) async {
    final id = const Uuid().v4();
    final m = Machine(
      id: id,
      name: name.trim(),
      kind: kind,
      exerciseIds: exerciseIds,
      groupId: id,
      createdBy: _repo.me,
      createdAt: DateTime.now(),
    );
    await _repo.saveMachine(m, _photos(id, vectors));
    await reload();
    return m;
  }

  Future<void> addPhotos(Machine machine, List<List<double>> vectors) async {
    await _repo.addPhotos(_photos(machine.id, vectors));
    await reload();
  }

  Future<void> delete(Machine machine) async {
    await _repo.deleteMachine(machine);
    await reload();
  }

  Future<MatchResult?> match(List<double> query) async {
    final s = state.valueOrNull ?? await future;
    return ref.read(matcherProvider).match(query, s.machines, s.photos);
  }
}

/// 기구를 고르면 어떤 종목으로 시작할지. 그 기구로 내가 마지막에 한 종목, 없으면 첫 종목(설계 §3).
Exercise? defaultExerciseFor(Machine machine, List<WorkoutSet> history) {
  final v = machine.variant;
  final sorted = [...history]..sort((a, b) => b.at.compareTo(a.at));
  for (final s in sorted) {
    if (s.variant == v && machine.exerciseIds.contains(s.exerciseId)) return exerciseById(s.exerciseId);
  }
  return machine.exercises.firstOrNull;
}

/// 등록할 때 고를 수 있는 종목: 그 기구 종류로 할 수 있는 것.
List<Exercise> exercisesFor(MachineKind kind) =>
    exerciseCatalog.where((e) => e.variants.contains(kind.catalogVariant)).toList();
