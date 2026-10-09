import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'routine.dart';

/// 내 루틴. 본인만 읽고 쓴다(users/{uid}/routines).
abstract class RoutineRepository {
  Future<List<Routine>> routines();

  Future<void> save(Routine routine);

  Future<void> delete(String id);

  /// 오프라인 준비.
  Future<void> prime();
}

class LocalRoutineRepository implements RoutineRepository {
  LocalRoutineRepository(this._prefs);

  final SharedPreferences _prefs;
  static const _key = 'mytrainer.routines';

  Map<String, dynamic> _read() {
    final raw = _prefs.getString(_key);
    return raw == null ? {} : (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  @override
  Future<List<Routine>> routines() async =>
      [for (final e in _read().entries) Routine.fromJson(e.key, (e.value as Map).cast())];

  @override
  Future<void> save(Routine routine) =>
      _prefs.setString(_key, jsonEncode(_read()..[routine.id] = routine.toJson()));

  @override
  Future<void> delete(String id) => _prefs.setString(_key, jsonEncode(_read()..remove(id)));

  @override
  Future<void> prime() async {}
}

/// 쓰기는 기다리지 않고 읽기는 캐시에서(FirestoreAttendanceRepository 와 같은 이유).
class FirestoreRoutineRepository implements RoutineRepository {
  FirestoreRoutineRepository(this._db, this._uid);

  final FirebaseFirestore _db;
  final String _uid;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection('users').doc(_uid).collection('routines');

  void _noWait(Future<void> write, String what) =>
      unawaited(write.catchError((Object e) => debugPrint('$what 저장 실패: $e')));

  @override
  Future<List<Routine>> routines() async {
    final q = await _col.get(const GetOptions(source: Source.cache));
    return [for (final d in q.docs) Routine.fromJson(d.id, d.data())];
  }

  @override
  Future<void> save(Routine routine) async => _noWait(_col.doc(routine.id).set(routine.toJson()), '루틴');

  @override
  Future<void> delete(String id) async => _noWait(_col.doc(id).delete(), '루틴 삭제');

  @override
  Future<void> prime() => _col.get(const GetOptions(source: Source.server));
}
