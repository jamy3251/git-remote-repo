import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'models.dart';
import 'repository.dart';
import 'workout.dart';

/// users/{uid}/... 아래 본인 데이터. 보안 규칙에서 본인만 읽고 쓴다.
///
/// 오프라인(지하 헬스장)에서 멈추지 않게 하는 두 가지:
///
/// - 쓰기: Firestore 의 쓰기 Future 는 서버가 받아야 끝난다. 오프라인이면 연결될 때까지
///   안 끝나므로 기다리지 않는다. 로컬 캐시에는 바로 들어가 다음 읽기에 보이고,
///   쓰기 대기열이 연결되면 올린다.
/// - 읽기: 이 데이터를 쓰는 건 이 폰뿐이라(설치마다 익명 uid) 로컬 캐시가 곧 전부다.
///   그래서 캐시에서 읽는다. 연결이 애매할 때 서버를 기다리며 10초씩 멈추지 않는다.
///   캐시가 비었을 수 있는 경우(앱 데이터 일부 초기화 등)는 [prime] 이 서버에서 다시 채운다.
class FirestoreAttendanceRepository implements AttendanceRepository {
  FirestoreAttendanceRepository(this._db, this._uid);

  final FirebaseFirestore _db;
  final String _uid;

  static const _cache = GetOptions(source: Source.cache);
  static const _server = GetOptions(source: Source.server);

  /// 지오펜스 이벤트는 파일 큐에서 왔다. 서버 확인을 이만큼 기다리고, 넘으면 예외를 던져
  /// 파일을 남긴다(다음에 같은 id 로 다시 올리므로 중복은 없다).
  static const eventAckTimeout = Duration(seconds: 10);

  DocumentReference<Map<String, dynamic>> get _user => _db.collection('users').doc(_uid);

  CollectionReference<Map<String, dynamic>> _col(String name) => _user.collection(name);

  Future<void> _noWait(Future<void> write, String what) {
    unawaited(write.catchError((Object e) => debugPrint('$what 저장 실패: $e')));
    return Future.value();
  }

  Future<List<Map<String, dynamic>>> _read(Query<Map<String, dynamic>> q) async =>
      (await q.get(_cache)).docs.map((d) => d.data()).toList();

  Query<Map<String, dynamic>> _atSince(String col, DateTime since) =>
      _col(col).where('at', isGreaterThanOrEqualTo: since.millisecondsSinceEpoch);

  Query<Map<String, dynamic>> _reportsSince(DateTime since) =>
      _col('self_reports').where('day', isGreaterThanOrEqualTo: dayKey(since));

  @override
  Future<void> saveEvents(List<GeofenceEvent> events) async {
    if (events.isEmpty) return;
    final batch = _db.batch();
    for (final e in events) {
      batch.set(_col('geofence_events').doc(e.id), e.toJson());
    }
    await batch.commit().timeout(eventAckTimeout);
  }

  @override
  Future<List<GeofenceEvent>> events({required DateTime since}) async =>
      (await _read(_atSince('geofence_events', since))).map(GeofenceEvent.fromJson).toList();

  @override
  Future<void> saveReport(SelfReport report) =>
      _noWait(_col('self_reports').doc(dayKey(report.day)).set(report.toJson()), '자기보고');

  @override
  Future<List<SelfReport>> reports({required DateTime since}) async =>
      (await _read(_reportsSince(since))).map(SelfReport.fromJson).toList();

  @override
  Future<void> saveManual(ManualCheckIn checkIn) => _noWait(
      _col('manual_checkins')
          .doc('${checkIn.at.millisecondsSinceEpoch}')
          .set({'at': checkIn.at.millisecondsSinceEpoch}),
      '수동 체크인');

  @override
  Future<List<ManualCheckIn>> manual({required DateTime since}) async =>
      (await _read(_atSince('manual_checkins', since)))
          .map((d) => ManualCheckIn(at: DateTime.fromMillisecondsSinceEpoch((d['at'] as num).toInt())))
          .toList();

  @override
  Future<void> saveSet(WorkoutSet set) => _noWait(_col('sets').doc(set.id).set(set.toJson()), '세트');

  @override
  Future<void> deleteSet(String id) => _noWait(_col('sets').doc(id).delete(), '세트 삭제');

  @override
  Future<List<WorkoutSet>> sets({required DateTime since}) async =>
      (await _read(_atSince('sets', since))).map(WorkoutSet.fromJson).toList();

  @override
  Future<void> saveGym(Gym gym) =>
      _noWait(_user.set({'gym': gym.toJson()}, SetOptions(merge: true)), '헬스장');

  @override
  Future<Gym?> gym() async {
    DocumentSnapshot<Map<String, dynamic>> snap;
    try {
      snap = await _user.get(_cache);
    } on FirebaseException {
      // 캐시에 문서가 없으면 예외. 연결돼 있으면 서버에서 받는다.
      snap = await _user.get();
    }
    final g = snap.data()?['gym'];
    return g == null ? null : Gym.fromJson((g as Map).cast());
  }

  @override
  Future<void> prime({required DateTime setsSince, required DateTime attendanceSince}) async {
    await Future.wait([
      _user.get(_server),
      _atSince('sets', setsSince).get(_server),
      _atSince('geofence_events', attendanceSince).get(_server),
      _atSince('manual_checkins', attendanceSince).get(_server),
      _reportsSince(attendanceSince).get(_server),
    ]);
  }

  @override
  Future<int> pendingWrites() async {
    final since = DateTime.now().subtract(const Duration(days: 56));
    final snaps = await Future.wait([
      _atSince('sets', since).get(_cache),
      _atSince('geofence_events', since).get(_cache),
      _atSince('manual_checkins', since).get(_cache),
      _reportsSince(since).get(_cache),
    ]);
    var n = 0;
    for (final s in snaps) {
      n += s.docs.where((d) => d.metadata.hasPendingWrites).length;
    }
    return n;
  }
}
