import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'models.dart';
import 'repository.dart';
import 'workout.dart';

/// 이 폰에만 저장한다. 양이 작아서(하루 이벤트 몇 개) SharedPreferences 로 충분하다.
class LocalAttendanceRepository implements AttendanceRepository {
  LocalAttendanceRepository(this._prefs);

  final SharedPreferences _prefs;

  static const _eventsKey = 'mytrainer.events';
  static const _reportsKey = 'mytrainer.reports';
  static const _manualKey = 'mytrainer.manual';
  static const _gymKey = 'mytrainer.gym';
  static const _setsKey = 'mytrainer.sets';

  Map<String, dynamic> _readMap(String key) {
    final raw = _prefs.getString(key);
    if (raw == null) return {};
    return (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  Future<void> _writeMap(String key, Map<String, dynamic> map) =>
      _prefs.setString(key, jsonEncode(map));

  @override
  Future<void> saveEvents(List<GeofenceEvent> events) async {
    final map = _readMap(_eventsKey);
    for (final e in events) {
      map[e.id] = e.toJson();
    }
    await _writeMap(_eventsKey, map);
  }

  @override
  Future<List<GeofenceEvent>> events({required DateTime since}) async =>
      _readMap(_eventsKey)
          .values
          .map((j) => GeofenceEvent.fromJson((j as Map).cast()))
          .where((e) => !e.at.isBefore(since))
          .toList();

  @override
  Future<void> saveReport(SelfReport report) async {
    final map = _readMap(_reportsKey);
    map[dayKey(report.day)] = report.toJson();
    await _writeMap(_reportsKey, map);
  }

  @override
  Future<List<SelfReport>> reports({required DateTime since}) async =>
      _readMap(_reportsKey)
          .values
          .map((j) => SelfReport.fromJson((j as Map).cast()))
          .where((r) => !r.day.isBefore(DateTime(since.year, since.month, since.day)))
          .toList();

  @override
  Future<void> saveManual(ManualCheckIn checkIn) async {
    final map = _readMap(_manualKey);
    map['${checkIn.at.millisecondsSinceEpoch}'] = checkIn.at.millisecondsSinceEpoch;
    await _writeMap(_manualKey, map);
  }

  @override
  Future<List<ManualCheckIn>> manual({required DateTime since}) async =>
      _readMap(_manualKey)
          .values
          .map((ms) => ManualCheckIn(at: DateTime.fromMillisecondsSinceEpoch((ms as num).toInt())))
          .where((m) => !m.at.isBefore(since))
          .toList();

  @override
  Future<void> saveSet(WorkoutSet set) async {
    final map = _readMap(_setsKey);
    map[set.id] = set.toJson();
    await _writeMap(_setsKey, map);
  }

  @override
  Future<void> deleteSet(String id) async {
    final map = _readMap(_setsKey)..remove(id);
    await _writeMap(_setsKey, map);
  }

  @override
  Future<List<WorkoutSet>> sets({required DateTime since}) async => _readMap(_setsKey)
      .values
      .map((j) => WorkoutSet.fromJson((j as Map).cast()))
      .where((s) => !s.at.isBefore(since))
      .toList();

  @override
  Future<void> saveGym(Gym gym) => _prefs.setString(_gymKey, jsonEncode(gym.toJson()));

  @override
  Future<Gym?> gym() async {
    final raw = _prefs.getString(_gymKey);
    if (raw == null) return null;
    return Gym.fromJson((jsonDecode(raw) as Map).cast());
  }

  @override
  Future<void> prime({required DateTime setsSince, required DateTime attendanceSince}) async {}

  @override
  Future<int> pendingWrites() async => 0;
}
