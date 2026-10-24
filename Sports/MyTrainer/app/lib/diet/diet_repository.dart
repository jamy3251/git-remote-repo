import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/models.dart' show dayKey;
import 'body_profile.dart';
import 'meal.dart';
import 'tracking.dart';

/// 식단 기록·체중·몸 정보. 본인만 읽고 쓴다(users/{uid}/meals, weights/{yyyy-MM-dd}, meta/body).
abstract class DietRepository {
  Future<List<MealEntry>> meals({required DateTime since});

  Future<void> saveMeal(MealEntry entry);

  Future<void> deleteMeal(String id);

  Future<BodyProfile?> profile();

  Future<void> saveProfile(BodyProfile profile);

  /// 체중은 하루 한 번. 같은 날 다시 재면 덮어쓴다.
  Future<List<WeightEntry>> weights({required DateTime since});

  Future<void> saveWeight(WeightEntry entry);

  Future<void> deleteWeight(DateTime day);

  /// 오프라인 준비(식단 30일·체중 5주(실측 유지 열량용) + 몸 정보).
  Future<void> prime();
}

class LocalDietRepository implements DietRepository {
  LocalDietRepository(this._prefs);

  final SharedPreferences _prefs;
  static const _mealsKey = 'mytrainer.meals';
  static const _profileKey = 'mytrainer.body';
  static const _weightsKey = 'mytrainer.weights';

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

  Map<String, dynamic> _readWeights() {
    final raw = _prefs.getString(_weightsKey);
    return raw == null ? {} : (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  @override
  Future<List<WeightEntry>> weights({required DateTime since}) async => [
        for (final v in _readWeights().values)
          if (WeightEntry.fromJson((v as Map).cast()) case final w when !w.day.isBefore(dayOf(since))) w,
      ];

  @override
  Future<void> saveWeight(WeightEntry entry) =>
      _prefs.setString(_weightsKey, jsonEncode(_readWeights()..[dayKey(entry.day)] = entry.toJson()));

  @override
  Future<void> deleteWeight(DateTime day) =>
      _prefs.setString(_weightsKey, jsonEncode(_readWeights()..remove(dayKey(day))));

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
  CollectionReference<Map<String, dynamic>> get _weights => _user.collection('weights');
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
  Future<List<WeightEntry>> weights({required DateTime since}) async {
    final q = await _weights
        .where('day', isGreaterThanOrEqualTo: dayOf(since).millisecondsSinceEpoch)
        .get(const GetOptions(source: Source.cache));
    return [for (final d in q.docs) WeightEntry.fromJson(d.data())];
  }

  @override
  Future<void> saveWeight(WeightEntry entry) async =>
      _noWait(_weights.doc(dayKey(entry.day)).set(entry.toJson()), '체중');

  @override
  Future<void> deleteWeight(DateTime day) async => _noWait(_weights.doc(dayKey(day)).delete(), '체중 삭제');

  @override
  Future<void> prime() async {
    final since = _clock().subtract(const Duration(days: 35));
    await _weights.where('day', isGreaterThanOrEqualTo: dayOf(since).millisecondsSinceEpoch).get(const GetOptions(source: Source.server));
    await _meals
        .where('at', isGreaterThanOrEqualTo: _clock().subtract(const Duration(days: 30)).millisecondsSinceEpoch)
        .get(const GetOptions(source: Source.server));
    await _body.get(const GetOptions(source: Source.server));
  }
}
