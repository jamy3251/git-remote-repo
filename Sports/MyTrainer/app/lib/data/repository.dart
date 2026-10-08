import 'models.dart';
import 'workout.dart';

/// 출석·운동 기록을 읽고 쓰는 창구.
///
/// 구현체는 두 가지다(Familyeat 와 같은 구조).
/// - [LocalAttendanceRepository]     : 이 폰에만 저장. Firebase 설정 없이 동작한다.
/// - [FirestoreAttendanceRepository] : users/{uid}/... 에 저장. 오프라인 영속성을 켜서
///   지하 헬스장에서 쓴 것도 연결되면 올라간다.
///
/// 여기 쓰는 것은 모두 본인만 읽는 개인 데이터다(지표 원본). 파티에 보이는
/// 공개 출석은 동의·숨김 여부를 보고 따로 쓴다(설계 D17).
abstract class AttendanceRepository {
  /// [GeofenceEvent.id] 를 키로 쓴다. 같은 이벤트를 다시 올려도 한 건이다.
  Future<void> saveEvents(List<GeofenceEvent> events);

  Future<List<GeofenceEvent>> events({required DateTime since});

  /// 날짜당 하나. 다시 답하면 덮어쓴다.
  Future<void> saveReport(SelfReport report);

  Future<List<SelfReport>> reports({required DateTime since});

  Future<void> saveManual(ManualCheckIn checkIn);

  Future<List<ManualCheckIn>> manual({required DateTime since});

  /// [WorkoutSet.id] 가 키. 같은 id 로 다시 쓰면 수정이다.
  Future<void> saveSet(WorkoutSet set);

  Future<void> deleteSet(String id);

  Future<List<WorkoutSet>> sets({required DateTime since});

  Future<void> saveGym(Gym gym);

  Future<Gym?> gym();

  /// 오프라인 준비. 서버에서 받아 로컬 캐시를 채운다. 연결이 없으면 예외.
  /// 이 폰 전용 모드는 할 일이 없다.
  Future<void> prime({required DateTime setsSince, required DateTime attendanceSince});

  /// 이 폰에서 썼지만 아직 서버에 안 올라간 문서 수.
  Future<int> pendingWrites();
}
