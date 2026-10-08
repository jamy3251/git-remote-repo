import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../party/party_repository.dart';
import 'machine.dart';

/// 기구와 기구 사진 임베딩. 파티원이 같이 쓴다(설계 §3, 규칙은 firestore.rules).
abstract class MachineRepository {
  /// 등록자(createdBy)로 남는 내 id.
  String get me;

  Future<List<Machine>> machines();

  /// 모든 기구의 사진 임베딩(기구 30~50개 x 2~3장).
  Future<List<MachinePhoto>> photos();

  Future<void> saveMachine(Machine machine, List<MachinePhoto> photos);

  /// "기존 기구에 사진 추가".
  Future<void> addPhotos(List<MachinePhoto> photos);

  /// 기구와 그 사진을 지운다. 등록자 또는 파티장만(규칙에서도 막는다).
  Future<void> deleteMachine(Machine machine);

  Future<bool> canManage(Machine machine);

  /// 오프라인 준비: 서버에서 받아 캐시를 채운다.
  Future<void> prime();
}

/// 이 폰에만. Firebase 가 없을 때.
class LocalMachineRepository implements MachineRepository {
  LocalMachineRepository(this._prefs);

  final SharedPreferences _prefs;

  static const _machinesKey = 'mytrainer.machines';
  static const _photosKey = 'mytrainer.machine_photos';

  @override
  String get me => 'local';

  Map<String, dynamic> _read(String key) {
    final raw = _prefs.getString(key);
    return raw == null ? {} : (jsonDecode(raw) as Map).cast<String, dynamic>();
  }

  Future<void> _write(String key, Map<String, dynamic> m) => _prefs.setString(key, jsonEncode(m));

  @override
  Future<List<Machine>> machines() async => [
        for (final e in _read(_machinesKey).entries) Machine.fromJson(e.key, (e.value as Map).cast()),
      ];

  @override
  Future<List<MachinePhoto>> photos() async => [
        for (final e in _read(_photosKey).entries)
          MachinePhoto.fromJson(e.key, (e.value as Map)['machineId'] as String, (e.value as Map).cast()),
      ];

  @override
  Future<void> saveMachine(Machine machine, List<MachinePhoto> photos) async {
    await _write(_machinesKey, _read(_machinesKey)..[machine.id] = machine.toJson());
    await addPhotos(photos);
  }

  @override
  Future<void> addPhotos(List<MachinePhoto> photos) async {
    final m = _read(_photosKey);
    for (final p in photos) {
      m[p.id] = {...p.toJson(), 'machineId': p.machineId};
    }
    await _write(_photosKey, m);
  }

  @override
  Future<void> deleteMachine(Machine machine) async {
    await _write(_machinesKey, _read(_machinesKey)..remove(machine.id));
    await _write(_photosKey, _read(_photosKey)..removeWhere((_, v) => (v as Map)['machineId'] == machine.id));
  }

  @override
  Future<bool> canManage(Machine machine) async => true;

  @override
  Future<void> prime() async {}
}

/// parties/{pid}/machines/{mid}(/photos/{id}).
///
/// 첫 기구를 등록할 때 파티가 없으면 나를 파티장으로 만든다([PartyRepository.ensureParty]).
/// 쓰기는 기다리지 않고 읽기는 캐시에서 한다(FirestoreAttendanceRepository 와 같은 이유).
/// 남이 등록한 기구는 [prime] 으로 받아 둬야 지하에서 보인다.
class FirestoreMachineRepository implements MachineRepository {
  FirestoreMachineRepository(this._db, this._party);

  final FirebaseFirestore _db;
  final PartyRepository _party;

  static const _cache = GetOptions(source: Source.cache);
  static const _server = GetOptions(source: Source.server);

  @override
  String get me => _party.me;

  void _noWait(Future<void> write, String what) =>
      unawaited(write.catchError((Object e) => debugPrint('$what 저장 실패: $e')));

  CollectionReference<Map<String, dynamic>> _machines(String pid) =>
      _db.collection('parties').doc(pid).collection('machines');

  @override
  Future<List<Machine>> machines() async {
    final pid = await _party.partyId();
    if (pid == null) return const [];
    final q = await _machines(pid).get(_cache);
    return [for (final d in q.docs) Machine.fromJson(d.id, d.data())];
  }

  @override
  Future<List<MachinePhoto>> photos() async {
    final pid = await _party.partyId();
    if (pid == null) return const [];
    final ms = await _machines(pid).get(_cache);
    final snaps = await Future.wait([for (final m in ms.docs) m.reference.collection('photos').get(_cache)]);
    return [
      for (final (i, s) in snaps.indexed)
        for (final d in s.docs) MachinePhoto.fromJson(d.id, ms.docs[i].id, d.data()),
    ];
  }

  @override
  Future<void> saveMachine(Machine machine, List<MachinePhoto> photos) async {
    final pid = await _party.ensureParty();
    final ref = _machines(pid).doc(machine.id);
    final batch = _db.batch()..set(ref, machine.toJson());
    for (final p in photos) {
      batch.set(ref.collection('photos').doc(p.id), p.toJson());
    }
    _noWait(batch.commit(), '기구 등록');
  }

  @override
  Future<void> addPhotos(List<MachinePhoto> photos) async {
    final pid = await _party.ensureParty();
    final batch = _db.batch();
    for (final p in photos) {
      batch.set(_machines(pid).doc(p.machineId).collection('photos').doc(p.id), p.toJson());
    }
    _noWait(batch.commit(), '기구 사진 추가');
  }

  @override
  Future<void> deleteMachine(Machine machine) async {
    final pid = await _party.partyId();
    if (pid == null) return;
    final ref = _machines(pid).doc(machine.id);
    final photos = await ref.collection('photos').get(_cache);
    final batch = _db.batch();
    for (final d in photos.docs) {
      batch.delete(d.reference);
    }
    batch.delete(ref);
    _noWait(batch.commit(), '기구 삭제');
  }

  @override
  Future<bool> canManage(Machine machine) async {
    if (machine.createdBy == me) return true;
    return (await _party.party())?.ownerId == me;
  }

  @override
  Future<void> prime() async {
    await _party.prime();
    final pid = await _party.partyId();
    if (pid == null) return;
    final ms = await _machines(pid).get(_server);
    await Future.wait([for (final m in ms.docs) m.reference.collection('photos').get(_server)]);
  }
}
