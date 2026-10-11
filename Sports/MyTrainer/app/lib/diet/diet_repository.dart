import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'body_profile.dart';
import 'meal.dart';

/// 식단 기록과 몸 정보. 본인만 읽고 쓴다(users/{uid}/meals, users/{uid}/meta/body).
abstract class DietRepository {
  Future<List<MealEntry>> meals({required DateTime since});

  Future<void> saveMeal(MealEntry entry);

  Future<void> deleteMeal(String id);

  Future<BodyProfile?> profile();

  Future<void> saveProfile(BodyProfile profile);

  /// 오프라인 준비(최근 2주 식단 + 몸 정보).
  Future<void> prime();
}

class LocalDietRepository implements DietRepository {
  LocalDietRepository(this._prefs);

  final SharedPreferences _prefs;
  static const _mealsKey = 'mytrainer.meals';
  static const _profileKey = 'mytrainer.body';

  Map<String, dynamic> _read() {
    final raw = _prefs.getString(_mealsKey);
    return raw == null ? {} : (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  @override
  Future<List<MealEntry>> meals({required DateTime since}) async => [
        for (final e in _read().entries)
          if (MealEntry.fromJson(e.key, (e.value as Map).cast()) case final m when !m.at.isBefore(since)) m,
      ];

  @override
  Future<void> saveMeal(MealEntry entry) =>
      _prefs.setString(_mealsKey, jsonEncode(_read()..[entry.id] = entry.toJson()));

  @override
  Future<void> deleteMeal(String id) => _prefs.setString(_mealsKey, jsonEncode(_read()..remove(id)));

  @override
  Future<BodyProfile?> profile() async {
    final raw = _prefs.getString(_profileKey);
    return raw == null ? null : BodyProfile.fromJson((jsonDecode(raw) as Map).cast());
  }

  @override
  Future<void> saveProfile(BodyProfile profile) => _prefs.setString(_profileKey, jsonEncode(profile.toJson()));

  @override
  Future<void> prime() async {}
}

/// 쓰기는 기다리지 않고 읽기는 캐시에서(FirestoreAttendanceRepository 와 같은 이유).
class FirestoreDietRepository implements DietRepository {
  FirestoreDietRepository(this._db, this._uid, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final FirebaseFirestore _db;
  final String _uid;
  final DateTime Function() _clock;

  DocumentReference<Map<String, dynamic>> get _user => _db.collection('users').doc(_uid);
  CollectionReference<Map<String, dynamic>> get _meals => _user.collection('meals');
  DocumentReference<Map<String, dynamic>> get _body => _user.collection('meta').doc('body');

  void _noWait(Future<void> write, String what) =>
      unawaited(write.catchError((Object e) => debugPrint('$what 저장 실패: $e')));

  @override
  Future<List<MealEntry>> meals({required DateTime since}) async {
    final q = await _meals
        .where('at', isGreaterThanOrEqualTo: since.millisecondsSinceEpoch)
        .get(const GetOptions(source: Source.cache));
    return [for (final d in q.docs) MealEntry.fromJson(d.id, d.data())];
  }

  @override
  Future<void> saveMeal(MealEntry entry) async => _noWait(_meals.doc(entry.id).set(entry.toJson()), '식단');

  @override
  Future<void> deleteMeal(String id) async => _noWait(_meals.doc(id).delete(), '식단 삭제');

  @override
  Future<BodyProfile?> profile() async {
    try {
      final d = await _body.get(const GetOptions(source: Source.cache));
      return d.data() == null ? null : BodyProfile.fromJson(d.data()!);
    } on FirebaseException {
      return null; // 캐시에 아직 없음
    }
  }

  @override
  Future<void> saveProfile(BodyProfile profile) async => _noWait(_body.set(profile.toJson()), '몸 정보');

  @override
  Future<void> prime() async {
    await _meals
        .where('at', isGreaterThanOrEqualTo: _clock().subtract(const Duration(days: 14)).millisecondsSinceEpoch)
        .get(const GetOptions(source: Source.server));
    await _body.get(const GetOptions(source: Source.server));
  }
}
