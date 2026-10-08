import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/firestore_repository.dart';
import '../data/local_repository.dart';
import '../data/repository.dart';
import '../machines/machine_repository.dart';
import '../party/party_repository.dart';
import '../routines/routine_extractor.dart';
import '../routines/routine_repository.dart';

enum SyncMode { cloud, local }

/// Firebase 를 붙일 수 있으면 붙이고, 아니면 로컬 저장소로 떨어진다(Familyeat 방식).
///
/// google-services.json 이 없으면 [Firebase.initializeApp] 이 예외를 던진다.
/// 그걸 잡아서 앱이 죽지 않고 이 폰 전용 모드로 계속 간다.
///
/// 한계: 처음 설치하고 오프라인이면 익명 로그인을 못 해서 로컬 모드로 시작한다.
/// 그 사이 기록은 클라우드로 옮겨지지 않으니, 첫 실행은 와이파이에서 하도록
/// 온보딩에서 안내한다.
Future<(AttendanceRepository, SyncMode)> createRepository(SharedPreferences prefs) async {
  try {
    await Firebase.initializeApp();
    // AI 요청(영상 루틴 복사)을 이 앱에서 온 것만 받게 한다(설계 D10). 디버그 빌드는 콘솔에
    // 디버그 토큰을 등록해야 한다. 실패해도 출석·기록은 계속 동작한다.
    try {
      await FirebaseAppCheck.instance.activate(
        androidProvider: kDebugMode ? AndroidProvider.debug : AndroidProvider.playIntegrity,
      );
    } catch (e) {
      debugPrint('App Check 시작 실패: $e');
    }
    final db = FirebaseFirestore.instance;
    // 지하 헬스장에서도 기록이 사라지지 않도록 로컬 캐시와 쓰기 대기열을 켠다.
    db.settings = const Settings(
      persistenceEnabled: true,
      cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
    );

    final auth = FirebaseAuth.instance;
    final user = auth.currentUser ?? (await auth.signInAnonymously()).user;
    if (user == null) throw StateError('익명 로그인 결과가 비었어요');

    return (FirestoreAttendanceRepository(db, user.uid) as AttendanceRepository, SyncMode.cloud);
  } catch (error) {
    debugPrint('Firebase 연결 없이 로컬 모드로 시작합니다: $error');
    return (LocalAttendanceRepository(prefs) as AttendanceRepository, SyncMode.local);
  }
}

/// [createRepository] 뒤에 부른다. 서버 모드면 같은 익명 사용자의 파티.
PartyRepository createPartyRepository(SharedPreferences prefs, SyncMode mode) {
  final user = mode == SyncMode.cloud ? FirebaseAuth.instance.currentUser : null;
  if (user == null) return LocalPartyRepository();
  return FirestorePartyRepository(FirebaseFirestore.instance, user.uid, prefs);
}

/// 파티 기구. 이 폰 전용 모드면 로컬.
MachineRepository createMachineRepository(SharedPreferences prefs, PartyRepository party) =>
    party.available ? FirestoreMachineRepository(FirebaseFirestore.instance, party) : LocalMachineRepository(prefs);

/// 내 루틴. 이 폰 전용 모드면 로컬.
RoutineRepository createRoutineRepository(SharedPreferences prefs, SyncMode mode) {
  final user = mode == SyncMode.cloud ? FirebaseAuth.instance.currentUser : null;
  if (user == null) return LocalRoutineRepository(prefs);
  return FirestoreRoutineRepository(FirebaseFirestore.instance, user.uid);
}

/// 영상 루틴 추출. Firebase 가 없으면 못 쓴다.
RoutineExtractor createRoutineExtractor(SyncMode mode) =>
    mode == SyncMode.cloud ? GeminiRoutineExtractor() : UnavailableExtractor();
