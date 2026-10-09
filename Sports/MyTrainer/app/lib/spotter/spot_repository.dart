import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../data/exercises.dart';
import '../party/party_repository.dart';

/// 친구가 찍어 보낸 반복 수. 리프터가 확인해야 내 기록이 된다(설계 §4, D4).
@immutable
class PendingSpot {
  const PendingSpot({
    required this.id,
    required this.spotterId,
    required this.lifterId,
    required this.exerciseId,
    required this.variant,
    required this.reps,
    required this.createdAt,
  });

  final String id;
  final String spotterId;
  final String lifterId;
  final String exerciseId;
  final Variant variant;
  final int reps;

  /// 서버 시각. 만료는 이 24시간 뒤(규칙도 같은 기준으로 막는다).
  final DateTime createdAt;

  static const ttl = Duration(hours: 24);

  bool isExpired(DateTime now) => !now.isBefore(createdAt.add(ttl));
}

abstract class SpotRepository {
  bool get available;

  /// 촬영자: 리프터에게 보낸다. 오프라인이면 연결될 때 올라간다.
  Future<void> send({required String lifterId, required String exerciseId, required Variant variant, required int reps});

  /// 리프터: 나에게 온 확인 대기(만료 안 된 것). 실시간.
  Stream<List<PendingSpot>> incoming();

  Future<void> confirm(PendingSpot spot, int reps);

  Future<void> reject(PendingSpot spot);
}

class LocalSpotRepository implements SpotRepository {
  @override
  bool get available => false;

  @override
  Future<void> send({required String lifterId, required String exerciseId, required Variant variant, required int reps}) =>
      throw StateError('서버에 연결된 상태에서만 친구에게 보낼 수 있어요');

  @override
  Stream<List<PendingSpot>> incoming() => Stream.value(const []);

  @override
  Future<void> confirm(PendingSpot spot, int reps) async {}

  @override
  Future<void> reject(PendingSpot spot) async {}
}

/// parties/{pid}/pending_spots. 서버 코드·푸시 없이 앱이 켜져 있을 때 실시간 리스너로 받는다(D4).
class FirestoreSpotRepository implements SpotRepository {
  FirestoreSpotRepository(this._db, this._party, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final FirebaseFirestore _db;
  final PartyRepository _party;
  final DateTime Function() _clock;

  @override
  bool get available => true;

  CollectionReference<Map<String, dynamic>> _spots(String pid) =>
      _db.collection('parties').doc(pid).collection('pending_spots');

  void _noWait(Future<void> write, String what) =>
      unawaited(write.catchError((Object e) => debugPrint('$what 실패: $e')));

  @override
  Future<void> send({required String lifterId, required String exerciseId, required Variant variant, required int reps}) async {
    final pid = await _party.ensureParty();
    _noWait(
      _spots(pid).doc().set({
        'spotterId': _party.me,
        'lifterId': lifterId,
        'exerciseId': exerciseId,
        'variant': variant.key,
        'reps': reps,
        'status': 'pending',
        // 규칙이 서버 시각인지 확인한다(만료를 늦추지 못하게).
        'createdAt': FieldValue.serverTimestamp(),
      }),
      '스포터 결과 보내기',
    );
  }

  @override
  Stream<List<PendingSpot>> incoming() async* {
    final pid = await _party.partyId();
    if (pid == null) {
      yield const [];
      return;
    }
    yield* _spots(pid)
        .where('lifterId', isEqualTo: _party.me)
        .where('status', isEqualTo: 'pending')
        .snapshots()
        .map((q) {
      final now = _clock();
      return [
        for (final d in q.docs)
          if (_parse(d) case final s? when !s.isExpired(now)) s,
      ]..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    });
  }

  PendingSpot? _parse(QueryDocumentSnapshot<Map<String, dynamic>> d) {
    final j = d.data();
    final at = j['createdAt'];
    if (at is! Timestamp) return null;
    return PendingSpot(
      id: d.id,
      spotterId: j['spotterId'] as String,
      lifterId: j['lifterId'] as String,
      exerciseId: j['exerciseId'] as String,
      variant: Variant.parse(j['variant'] as String? ?? 'barbell'),
      reps: (j['reps'] as num).toInt(),
      createdAt: at.toDate(),
    );
  }

  @override
  Future<void> confirm(PendingSpot spot, int reps) async {
    final pid = await _party.partyId();
    if (pid == null) return;
    _noWait(_spots(pid).doc(spot.id).update({'status': 'confirmed', 'reps': reps}), '스포터 확인');
  }

  @override
  Future<void> reject(PendingSpot spot) async {
    final pid = await _party.partyId();
    if (pid == null) return;
    _noWait(_spots(pid).doc(spot.id).update({'status': 'rejected'}), '스포터 거절');
  }
}
