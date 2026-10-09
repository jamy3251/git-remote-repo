import 'dart:async';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

@immutable
class Party {
  const Party({required this.id, required this.name, required this.ownerId, required this.inviteCode});

  final String id;
  final String name;
  final String ownerId;
  final String inviteCode;
}

@immutable
class Member {
  const Member({required this.uid, required this.displayName});

  final String uid;
  final String displayName;
}

class JoinError implements Exception {
  const JoinError(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 내 파티. 파티 하나에 헬스장 하나(설계: 헬스장 1곳 전용).
///
/// 파티는 처음 필요할 때(기구 등록, 초대 코드 보기) 나를 파티장으로 만든다.
/// 친구는 8자리 초대 코드로 들어온다: invites/{코드} → 파티 id, 가입 문서에 코드를 적어
/// 규칙이 파티의 inviteCode 와 맞는지 확인한다.
abstract class PartyRepository {
  /// 서버 모드에서만 파티가 있다.
  bool get available;

  String get me;

  Future<String?> partyId();

  Future<String> ensureParty();

  Future<Party?> party();

  Future<List<Member>> members();

  /// 다른 파티에 들어간다. 연결이 있어야 한다.
  Future<void> join(String code, String displayName);

  Future<void> setMyName(String name);

  Future<void> prime();
}

class LocalPartyRepository implements PartyRepository {
  @override
  bool get available => false;

  @override
  String get me => 'local';

  @override
  Future<String?> partyId() async => null;

  @override
  Future<String> ensureParty() => throw const JoinError('파티는 서버에 연결된 상태에서만 쓸 수 있어요');

  @override
  Future<Party?> party() async => null;

  @override
  Future<List<Member>> members() async => const [];

  @override
  Future<void> join(String code, String displayName) => ensureParty();

  @override
  Future<void> setMyName(String name) async {}

  @override
  Future<void> prime() async {}
}

class FirestorePartyRepository implements PartyRepository {
  FirestorePartyRepository(this._db, this._uid, this._prefs);

  final FirebaseFirestore _db;
  final String _uid;
  final SharedPreferences _prefs;

  static const partyKey = 'mytrainer.partyId';
  static const _cache = GetOptions(source: Source.cache);
  static const _server = GetOptions(source: Source.server);

  /// 가입은 서버가 확인해야 끝난다. 이만큼 기다린다.
  static const joinTimeout = Duration(seconds: 15);

  @override
  bool get available => true;

  @override
  String get me => _uid;

  DocumentReference<Map<String, dynamic>> get _user => _db.collection('users').doc(_uid);

  DocumentReference<Map<String, dynamic>> _party(String pid) => _db.collection('parties').doc(pid);

  void _noWait(Future<void> write, String what) =>
      unawaited(write.catchError((Object e) => debugPrint('$what 저장 실패: $e')));

  @override
  Future<String?> partyId() async {
    final cached = _prefs.getString(partyKey);
    if (cached != null) return cached;
    try {
      final pid = (await _user.get(_cache)).data()?['partyId'] as String?;
      if (pid != null) await _prefs.setString(partyKey, pid);
      return pid;
    } on FirebaseException {
      return null;
    }
  }

  @override
  Future<String> ensureParty() async {
    final existing = await partyId();
    if (existing != null) return existing;
    final party = _db.collection('parties').doc();
    final code = _inviteCode();
    final batch = _db.batch()
      ..set(party, {'ownerId': _uid, 'name': '우리 헬스장', 'inviteCode': code})
      ..set(party.collection('members').doc(_uid), {
        'displayName': '파티장',
        'joinedAt': DateTime.now().millisecondsSinceEpoch,
        // 출석 공유는 따로 동의받는다(D17).
        'shareAttendance': false,
        'hidden': false,
      })
      ..set(_db.collection('invites').doc(code), {'partyId': party.id, 'ownerId': _uid})
      ..set(_user, {'partyId': party.id}, SetOptions(merge: true));
    _noWait(batch.commit(), '파티 만들기');
    await _prefs.setString(partyKey, party.id);
    return party.id;
  }

  /// 헷갈리는 글자(0/O, 1/I)는 뺀다.
  static String _inviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final r = Random.secure();
    return List.generate(8, (_) => chars[r.nextInt(chars.length)]).join();
  }

  @override
  Future<Party?> party() async {
    final pid = await partyId();
    if (pid == null) return null;
    DocumentSnapshot<Map<String, dynamic>> snap;
    try {
      snap = await _party(pid).get(_cache);
    } on FirebaseException {
      snap = await _party(pid).get();
    }
    final d = snap.data();
    if (d == null) return null;
    final code = d['inviteCode'] as String;
    // T7 때 만든 파티에는 초대 문서가 없다. 파티장이면 지금 만든다.
    if (d['ownerId'] == _uid) {
      _noWait(_db.collection('invites').doc(code).set({'partyId': pid, 'ownerId': _uid}), '초대 코드');
    }
    return Party(id: pid, name: d['name'] as String? ?? '', ownerId: d['ownerId'] as String, inviteCode: code);
  }

  @override
  Future<List<Member>> members() async {
    final pid = await partyId();
    if (pid == null) return const [];
    final q = await _party(pid).collection('members').get(_cache);
    return [
      for (final d in q.docs) Member(uid: d.id, displayName: d.data()['displayName'] as String? ?? ''),
    ];
  }

  @override
  Future<void> join(String code, String displayName) async {
    final c = code.trim().toUpperCase();
    final DocumentSnapshot<Map<String, dynamic>> invite;
    try {
      invite = await _db.collection('invites').doc(c).get(_server).timeout(joinTimeout);
    } on TimeoutException {
      throw const JoinError('인터넷에 연결된 상태에서 다시 시도해 주세요');
    } on FirebaseException catch (e) {
      throw JoinError(e.code == 'unavailable' ? '인터넷에 연결된 상태에서 다시 시도해 주세요' : '코드를 확인하지 못했어요');
    }
    final pid = invite.data()?['partyId'] as String?;
    if (pid == null) throw const JoinError('없는 코드예요');
    if (pid == await partyId()) throw const JoinError('이미 이 파티에 있어요');

    final batch = _db.batch()
      ..set(_party(pid).collection('members').doc(_uid), {
        'displayName': displayName.trim(),
        'joinedAt': DateTime.now().millisecondsSinceEpoch,
        'shareAttendance': false,
        'hidden': false,
        'inviteCode': c,
      })
      ..set(_user, {'partyId': pid}, SetOptions(merge: true));
    try {
      await batch.commit().timeout(joinTimeout);
    } on TimeoutException {
      throw const JoinError('인터넷에 연결된 상태에서 다시 시도해 주세요');
    } on FirebaseException {
      throw const JoinError('코드가 바뀌었을 수 있어요. 파티장에게 다시 받아 주세요');
    }
    await _prefs.setString(partyKey, pid);
    await prime();
  }

  @override
  Future<void> setMyName(String name) async {
    final pid = await ensureParty();
    _noWait(_party(pid).collection('members').doc(_uid).update({'displayName': name.trim()}), '이름');
  }

  @override
  Future<void> prime() async {
    final pid = (await _user.get(_server)).data()?['partyId'] as String?;
    if (pid == null) return;
    await _prefs.setString(partyKey, pid);
    await Future.wait([
      _party(pid).get(_server),
      _party(pid).collection('members').get(_server),
    ]);
  }
}
