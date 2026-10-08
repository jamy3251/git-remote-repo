import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../bootstrap/firebase_bootstrap.dart';
import '../data/models.dart';
import '../data/offline_ready.dart';
import '../data/repository.dart';
import '../data/workout.dart';
import '../machines/machines_state.dart';
import '../routines/routines_state.dart';
import '../services/geofence_service.dart';
import '../services/location_access.dart';
import '../services/session_rules.dart';

// main 에서 실제 값으로 덮어쓴다.
final sharedPreferencesProvider = Provider<SharedPreferences>((_) => throw UnimplementedError());
final repositoryProvider = Provider<AttendanceRepository>((_) => throw UnimplementedError());
final syncModeProvider = Provider<SyncMode>((_) => SyncMode.local);

final geofenceServiceProvider = Provider((_) => GeofenceService());
final locationAccessServiceProvider = Provider((_) => const LocationAccessService());
final sessionRulesProvider = Provider((_) => const SessionRules());

/// 지금 단계. 베이스라인 2주는 출석만 모으고(기록 기능 꺼짐), 그 뒤 기록 모드로 간다.
enum StudyPhase { baseline, logging }

final studyPhaseProvider = StateProvider<StudyPhase>((ref) {
  final raw = ref.watch(sharedPreferencesProvider).getString('mytrainer.phase');
  return raw == StudyPhase.logging.name ? StudyPhase.logging : StudyPhase.baseline;
});

/// 진행자(본인)가 베이스라인이 끝나면 직접 바꾼다. 홈 제목을 길게 누르면 나온다.
Future<void> setStudyPhase(WidgetRef ref, StudyPhase phase) async {
  await ref.read(sharedPreferencesProvider).setString('mytrainer.phase', phase.name);
  ref.read(studyPhaseProvider.notifier).state = phase;
}

final onboardedProvider = StateProvider<bool>(
    (ref) => ref.watch(sharedPreferencesProvider).getBool('mytrainer.onboarded') ?? false);

final locationAccessProvider = FutureProvider<LocationAccess>(
    (ref) => ref.watch(locationAccessServiceProvider).status());

/// 홈 화면이 보는 출석 요약.
class AttendanceState {
  const AttendanceState({
    required this.now,
    required this.gym,
    required this.sessions,
    required this.days,
    required this.reports,
    required this.sets,
  });

  final DateTime now;
  final Gym? gym;
  final List<Session> sessions;
  final Map<String, DayVisit> days;
  final List<SelfReport> reports;

  /// 최근 [AttendanceController.window] 동안의 세트. 세트 완결도 분자와 체크인에 쓴다.
  final List<WorkoutSet> sets;

  String get todayKey => dayKey(now);

  List<Session> get todaySessions =>
      sessions.where((s) => dayKey(s.start) == todayKey).toList();

  Session? get openSession => sessions.where((s) => s.end == null).lastOrNull;

  /// 오늘 머문 시간 합. 진행 중이면 지금까지.
  Duration get todayStay => todaySessions.fold(
      Duration.zero, (sum, s) => sum + (s.end ?? now).difference(s.start));

  SelfReport? get todayReport =>
      reports.where((r) => dayKey(r.day) == todayKey).lastOrNull;

  /// 최근 [n]일(오늘 포함) 날짜 키, 오래된 것부터.
  List<String> recentDays(int n) =>
      [for (var i = n - 1; i >= 0; i--) dayKey(now.subtract(Duration(days: i)))];

  LoggingRate rateFor(int n, {required bool baseline}) {
    final keys = recentDays(n).toSet();
    return LoggingRate.of(days.values.where((d) => keys.contains(d.day)), baseline: baseline);
  }

  /// 오늘이 이번 주 세트 완결도 표본 날인가.
  bool get todayIsSample => isSampleDay(todayKey, days);

  int get todayAppSets => sets.where((s) => dayKey(s.at) == todayKey).length;

  CompletenessRate completenessFor(int n, {required bool baseline}) {
    final keys = recentDays(n).toSet();
    final appSets = <String, int>{};
    for (final s in sets) {
      final k = dayKey(s.at);
      appSets[k] = (appSets[k] ?? 0) + 1;
    }
    return CompletenessRate.of(
      reports.where((r) => keys.contains(dayKey(r.day))),
      baseline: baseline,
      appSetsByDay: appSets,
    );
  }
}

final attendanceProvider =
    AsyncNotifierProvider<AttendanceController, AttendanceState>(AttendanceController.new);

class AttendanceController extends AsyncNotifier<AttendanceState> {
  /// 지표는 2주 단위지만 여유 있게 4주를 읽는다.
  static const window = Duration(days: 28);

  AttendanceRepository get _repo => ref.read(repositoryProvider);

  @override
  Future<AttendanceState> build() => _load(flush: true);

  Future<AttendanceState> _load({bool flush = false}) async {
    if (flush) {
      try {
        // 홈 화면이 큐 때문에 멈춰 있으면 안 된다. 못 올린 건 다음 회차에 올라간다.
        await ref.read(geofenceServiceProvider).flush(_repo).timeout(const Duration(seconds: 5));
      } catch (_) {
        // 저장 실패·시간 초과 시 큐는 남아 있다. 화면은 이미 올라간 것만으로 그린다.
      }
    }
    final now = DateTime.now();
    final since = now.subtract(window);
    final rules = ref.read(sessionRulesProvider);
    final events = await _repo.events(since: since);
    final reports = await _repo.reports(since: since);
    final manual = await _repo.manual(since: since);
    final sets = await _repo.sets(since: since);
    final sessions = rules.sessions(
      events: events,
      manual: manual,
      sets: [for (final s in sets) SetMark(at: s.at, insideFence: s.insideFence)],
      now: now,
    );
    // 방금 쓴 것이 "올리기 전" 개수에 바로 보이게.
    unawaited(ref.read(offlineStatusProvider.notifier).recount());
    return AttendanceState(
      now: now,
      gym: await _repo.gym(),
      sessions: sessions,
      days: rules.days(sessions: sessions, reports: reports, now: now),
      reports: reports,
      sets: sets,
    );
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(() => _load(flush: true));
  }

  SelfReport _todayOr(bool went) =>
      state.valueOrNull?.todayReport ?? SelfReport(day: DateTime.now(), went: went);

  Future<void> answerWent(bool went) async {
    // "안 갔다"로 바꾸면 기록·세트 수 답도 의미가 없다.
    final report = went ? _todayOr(true).copyWith(went: true) : SelfReport(day: DateTime.now(), went: false);
    await _repo.saveReport(report);
    state = await AsyncValue.guard(_load);
  }

  Future<void> answerLoggedByHand(bool logged) async {
    await _repo.saveReport(_todayOr(true).copyWith(went: true, loggedByHand: logged));
    state = await AsyncValue.guard(_load);
  }

  /// 표본 날 "오늘 실제로 한 세트 수". [handLogged] 는 베이스라인에서만.
  Future<void> answerSetCounts({required int actual, int? handLogged}) async {
    await _repo.saveReport(
        _todayOr(true).copyWith(went: true, actualSets: actual, handLoggedSets: handLogged));
    state = await AsyncValue.guard(_load);
  }

  /// 세트를 기록·삭제한 뒤 부른다. 펜스 안 세트는 출석 체크인이 된다.
  Future<void> reload() async {
    state = await AsyncValue.guard(_load);
  }

  Future<void> manualCheckIn() async {
    await _repo.saveManual(ManualCheckIn(at: DateTime.now()));
    state = await AsyncValue.guard(_load);
  }
}

/// '항상 허용'이고 헬스장이 있으면 지오펜스를 건다. 여러 번 불러도 같은 id 로 덮어쓴다.
///
/// 온보딩에서 거부했다가 나중에 설정에서 켠 사람도 앱을 열면 자동 출석이 켜진다.
Future<void> ensureGeofence(WidgetRef ref) async {
  try {
    final access = await ref.read(locationAccessServiceProvider).status();
    if (access != LocationAccess.always) return;
    final gym = await ref.read(repositoryProvider).gym();
    if (gym == null) return;
    await ref.read(geofenceServiceProvider).register(gym);
  } catch (_) {
    // 등록 실패는 다음 실행 때 다시 시도한다. 그동안은 15분 위치 확인과 밤 질문이 보완한다.
  }
}

final offlineReadinessProvider =
    Provider((ref) => OfflineReadiness(ref.watch(sharedPreferencesProvider)));

final offlineStatusProvider =
    AsyncNotifierProvider<OfflineController, OfflineStatus>(OfflineController.new);

/// 홈 아래 "오프라인 준비됨" 줄. 설계 D13.
class OfflineController extends AsyncNotifier<OfflineStatus> {
  OfflineReadiness get _ready => ref.read(offlineReadinessProvider);

  @override
  Future<OfflineStatus> build() => _status();

  Future<OfflineStatus> _status() async {
    await _ready.reload();
    final local = ref.read(syncModeProvider) == SyncMode.local;
    var pending = 0;
    try {
      pending = await ref.read(repositoryProvider).pendingWrites() +
          await ref.read(geofenceServiceProvider).queued().timeout(const Duration(seconds: 2));
    } catch (_) {
      // 개수는 참고용이다. 못 세면 0으로 보인다.
    }
    return OfflineStatus(
      local: local,
      readyAt: _ready.readyAt,
      missing: _ready.missing,
      pendingUploads: pending,
    );
  }

  /// 앱을 열 때(6시간 간격)와 당겨서 새로고침할 때(강제) 부른다.
  Future<void> prepare({bool force = false}) async {
    if (ref.read(syncModeProvider) == SyncMode.cloud) {
      await _ready.prepare(
        offlineParts(
          ref.read(repositoryProvider),
          machines: ref.read(machineRepositoryProvider),
          routines: ref.read(routineRepositoryProvider),
        ),
        force: force,
      );
    }
    state = await AsyncValue.guard(_status);
  }

  /// 기록을 저장한 뒤 올리기 전 개수만 다시 센다.
  Future<void> recount() async {
    state = await AsyncValue.guard(_status);
  }
}
