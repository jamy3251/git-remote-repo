import 'package:flutter/foundation.dart';

import '../data/models.dart';

/// 출석 판정 규칙. 플러그인을 하나도 모르는 순수 계산이라 폰 없이 테스트된다.
///
/// 공모전의 핵심 숫자(기록 누락률)의 분모가 여기서 나온다. 규칙을 바꾸면
/// 베이스라인과 사용 기간 숫자가 서로 비교되지 않으니, 두 기간 모두 이
/// 클래스 하나만 거치게 한다.
class SessionRules {
  const SessionRules({
    this.minDwell = const Duration(minutes: 20),
    this.idleClose = const Duration(minutes: 90),
    this.cap = const Duration(hours: 4),
  });

  /// 이만큼 머물러야 "헬스장에 있었다"로 친다. 지나가기만 한 날을 거른다.
  final Duration minDwell;

  /// 이탈 이벤트가 안 오면 마지막 세트 후 이만큼 지나 세션을 닫는다.
  /// 세트가 하나도 없는 세션에는 쓰지 않는다(그때는 [cap] 만).
  final Duration idleClose;

  /// 어떤 경우에도 세션은 이보다 길지 않다.
  final Duration cap;

  /// 시간순 사건들을 세션으로 묶는다.
  ///
  /// 진행 중인 세션은 [Session.end] 가 null 이다.
  List<Session> sessions({
    required List<GeofenceEvent> events,
    List<SetMark> sets = const [],
    List<ManualCheckIn> manual = const [],
    required DateTime now,
  }) {
    final items = <_Item>[
      for (final e in events) _Item.geofence(e),
      for (final s in sets)
        if (s.insideFence) _Item.set(s.at),
      for (final m in manual) _Item.manual(m.at),
    ]..sort((a, b) => a.at.compareTo(b.at));

    final out = <Session>[];
    _Open? open;

    void closeIfExpired(DateTime t) {
      final o = open;
      if (o == null) return;
      final deadline = o.deadline(this);
      if (t.isAfter(deadline)) {
        out.add(o.close(deadline, o.hasSet && deadline != o.capAt(this)
            ? SessionEnd.idle
            : SessionEnd.cap));
        open = null;
      }
    }

    for (final it in items) {
      closeIfExpired(it.at);

      switch (it.type) {
        case _ItemType.exit:
          final o = open;
          if (o != null) {
            o.mock |= it.mock;
            out.add(o.close(it.at, SessionEnd.exit));
            open = null;
          }
        case _ItemType.enter:
          open ??= _Open(start: it.at, source: SessionSource.geofence);
          open!.touch(it.at, mock: it.mock);
        case _ItemType.dwell:
          // DWELL 은 머문 지 minDwell 이 지나야 온다. 진입을 놓쳤으면 거꾸로 계산한다.
          open ??= _Open(start: it.at.subtract(minDwell), source: SessionSource.geofence);
          open!
            ..sawDwell = true
            ..touch(it.at, mock: it.mock);
        case _ItemType.set:
          open ??= _Open(start: it.at, source: SessionSource.set);
          open!
            ..hasSet = true
            ..lastSet = it.at
            ..touch(it.at);
        case _ItemType.manual:
          open ??= _Open(start: it.at, source: SessionSource.manual);
          open!
            ..manual = true
            ..touch(it.at);
      }
    }

    closeIfExpired(now);
    final o = open;
    if (o != null) out.add(o.close(null, null));
    return out;
  }

  /// 날짜별 방문 요약.
  ///
  /// [reports] 는 밤 자기보고. 세션이 없어도 "갔다"고 답한 날은 방문일이 된다.
  Map<String, DayVisit> days({
    required List<Session> sessions,
    List<SelfReport> reports = const [],
    required DateTime now,
  }) {
    final byDay = <String, _DayAcc>{};
    _DayAcc acc(String k) => byDay.putIfAbsent(k, () => _DayAcc(k));

    for (final s in sessions) {
      final a = acc(dayKey(s.start));
      final end = s.end ?? now;
      final stayed = end.difference(s.start) >= minDwell;
      if (s.source == SessionSource.geofence && (s.sawDwell || stayed)) {
        a.geofenceDwell = true;
      }
      a.hasSet |= s.hasSet;
      a.manual |= s.manual;
      a.mock |= s.mock;
    }
    for (final r in reports) {
      final a = acc(dayKey(r.day));
      a.selfReportWent = r.went;
      a.loggedByHand = r.loggedByHand;
    }
    return {for (final e in byDay.entries) e.key: e.value.build()};
  }
}

/// 기록 누락률 집계. 베이스라인과 사용 기간이 같은 분모 규칙을 쓴다.
@immutable
class LoggingRate {
  const LoggingRate({
    required this.visitDays,
    required this.loggedDays,
    required this.recoveredBySetOnly,
    required this.conflicts,
  });

  /// 분모: 지오펜스 체류일 ∪ 자기보고 방문일.
  final int visitDays;

  /// 분자: 그중 기록이 있는 날.
  final int loggedDays;

  /// 세트 기록으로만 알게 된 날. 분모에 넣지 않고 따로 보고한다.
  final int recoveredBySetOnly;

  /// 지오펜스는 체류라는데 자기보고는 "안 갔다"인 날. 분모에는 들어간다.
  final int conflicts;

  double? get rate => visitDays == 0 ? null : loggedDays / visitDays;

  /// [baseline] 이면 분자는 "수기로 기록했다"는 자기보고, 아니면 앱 세트 기록.
  factory LoggingRate.of(Iterable<DayVisit> days, {required bool baseline}) {
    var visit = 0, logged = 0, recovered = 0, conflict = 0;
    for (final d in days) {
      if (d.recoveredBySetOnly) recovered++;
      if (!d.isVisit) continue;
      visit++;
      if (d.geofenceDwell && d.selfReportWent == false) conflict++;
      final didLog = baseline ? d.loggedByHand == true : d.hasSet;
      if (didLog) logged++;
    }
    return LoggingRate(
      visitDays: visit,
      loggedDays: logged,
      recoveredBySetOnly: recovered,
      conflicts: conflict,
    );
  }
}

enum SessionSource { geofence, set, manual }

enum SessionEnd { exit, idle, cap }

@immutable
class Session {
  const Session({
    required this.start,
    required this.end,
    required this.endReason,
    required this.source,
    required this.sawDwell,
    required this.hasSet,
    required this.manual,
    required this.mock,
  });

  final DateTime start;
  final DateTime? end;
  final SessionEnd? endReason;

  /// 세션을 처음 연 사건. geofence 가 아니면 자동 감지가 놓친 세션이다.
  final SessionSource source;
  final bool sawDwell;
  final bool hasSet;
  final bool manual;
  final bool mock;
}

@immutable
class DayVisit {
  const DayVisit({
    required this.day,
    required this.geofenceDwell,
    required this.selfReportWent,
    required this.loggedByHand,
    required this.hasSet,
    required this.manual,
    required this.mock,
  });

  final String day;
  final bool geofenceDwell;
  final bool? selfReportWent;
  final bool? loggedByHand;
  final bool hasSet;
  final bool manual;
  final bool mock;

  /// 분모에 들어가는 날.
  bool get isVisit => geofenceDwell || selfReportWent == true;

  /// 세트로만 알게 된 날(자동 감지도 자기보고도 없음).
  bool get recoveredBySetOnly => hasSet && !isVisit;
}

enum _ItemType { enter, dwell, exit, set, manual }

class _Item {
  _Item(this.type, this.at, {this.mock = false});

  factory _Item.geofence(GeofenceEvent e) => _Item(
        switch (e.kind) {
          GeofenceKind.enter => _ItemType.enter,
          GeofenceKind.dwell => _ItemType.dwell,
          GeofenceKind.exit => _ItemType.exit,
        },
        e.at,
        mock: e.mock,
      );
  factory _Item.set(DateTime at) => _Item(_ItemType.set, at);
  factory _Item.manual(DateTime at) => _Item(_ItemType.manual, at);

  final _ItemType type;
  final DateTime at;
  final bool mock;
}

class _Open {
  _Open({required this.start, required this.source});

  final DateTime start;
  final SessionSource source;
  bool sawDwell = false;
  bool hasSet = false;
  bool manual = false;
  bool mock = false;
  DateTime? lastSet;

  void touch(DateTime t, {bool mock = false}) => this.mock |= mock;

  DateTime capAt(SessionRules r) => start.add(r.cap);

  DateTime deadline(SessionRules r) {
    final cap = capAt(r);
    final ls = lastSet;
    if (ls == null) return cap;
    final idle = ls.add(r.idleClose);
    return idle.isBefore(cap) ? idle : cap;
  }

  Session close(DateTime? end, SessionEnd? reason) => Session(
        start: start,
        end: end,
        endReason: reason,
        source: source,
        sawDwell: sawDwell,
        hasSet: hasSet,
        manual: manual,
        mock: mock,
      );
}

class _DayAcc {
  _DayAcc(this.day);
  final String day;
  bool geofenceDwell = false;
  bool? selfReportWent;
  bool? loggedByHand;
  bool hasSet = false;
  bool manual = false;
  bool mock = false;

  DayVisit build() => DayVisit(
        day: day,
        geofenceDwell: geofenceDwell,
        selfReportWent: selfReportWent,
        loggedByHand: loggedByHand,
        hasSet: hasSet,
        manual: manual,
        mock: mock,
      );
}

/// 세트 완결도 표본 날인가. 그 주(월~일)의 첫 방문일이면 표본이다(설계 D11).
///
/// 매일 묻으면 귀찮아서 대충 답하게 된다. 주 1회로 줄이되, 날짜를 미리 정하면
/// 그날만 열심히 적을 수 있으니 "그 주에 처음 간 날"로 정한다.
bool isSampleDay(String day, Map<String, DayVisit> days) {
  final visit = days[day];
  if (visit == null || !visit.isVisit) return false;
  final d = DateTime.parse(day);
  final monday = d.subtract(Duration(days: d.weekday - DateTime.monday));
  for (var t = monday; t.isBefore(d); t = t.add(const Duration(days: 1))) {
    if (days[dayKey(t)]?.isVisit ?? false) return false;
  }
  return true;
}

/// 세트 완결도 = 기록한 세트 / 실제로 한 세트. 표본 날 자기보고만 쓴다.
@immutable
class CompletenessRate {
  const CompletenessRate({required this.sampleDays, required this.logged, required this.actual});

  final int sampleDays;
  final int logged;
  final int actual;

  double? get rate => actual == 0 ? null : logged / actual;

  /// [baseline] 이면 분자는 "수기로 적은 세트 수" 자기보고, 아니면 [appSetsByDay].
  /// 기록이 실제보다 많다고 나오면(자기보고 착오) 그날은 실제 세트 수로 자른다.
  factory CompletenessRate.of(
    Iterable<SelfReport> reports, {
    required bool baseline,
    Map<String, int> appSetsByDay = const {},
  }) {
    var days = 0, logged = 0, actual = 0;
    for (final r in reports) {
      final a = r.actualSets;
      if (a == null || a <= 0) continue;
      final l = baseline ? (r.handLoggedSets ?? 0) : (appSetsByDay[dayKey(r.day)] ?? 0);
      days++;
      actual += a;
      logged += l > a ? a : l;
    }
    return CompletenessRate(sampleDays: days, logged: logged, actual: actual);
  }
}
