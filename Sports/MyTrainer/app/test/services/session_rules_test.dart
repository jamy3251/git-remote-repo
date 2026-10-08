import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/data/models.dart';
import 'package:mytrainer/services/session_rules.dart';

DateTime t(int h, [int m = 0, int day = 7]) => DateTime(2026, 10, day, h, m);

GeofenceEvent ev(GeofenceKind k, DateTime at, {bool mock = false}) =>
    GeofenceEvent(id: '${k.name}-${at.millisecondsSinceEpoch}', kind: k, at: at, mock: mock);

void main() {
  const rules = SessionRules();
  final now = t(23, 0, 9);

  group('sessions', () {
    test('진입 후 이탈이면 이탈 시각에 닫힌다', () {
      final s = rules.sessions(events: [
        ev(GeofenceKind.enter, t(18)),
        ev(GeofenceKind.exit, t(19, 10)),
      ], now: now);
      expect(s, hasLength(1));
      expect(s.single.end, t(19, 10));
      expect(s.single.endReason, SessionEnd.exit);
    });

    test('이탈이 없고 세트가 있으면 마지막 세트 + 90분에 닫힌다', () {
      final s = rules.sessions(
        events: [ev(GeofenceKind.enter, t(18))],
        sets: [SetMark(at: t(18, 20), insideFence: true), SetMark(at: t(18, 50), insideFence: true)],
        now: now,
      );
      expect(s.single.end, t(20, 20));
      expect(s.single.endReason, SessionEnd.idle);
    });

    test('이탈도 세트도 없으면 4시간 상한에 닫힌다', () {
      final s = rules.sessions(events: [ev(GeofenceKind.enter, t(18))], now: now);
      expect(s.single.end, t(22));
      expect(s.single.endReason, SessionEnd.cap);
    });

    test('세트가 계속 이어져도 4시간을 넘지 않는다', () {
      final s = rules.sessions(
        events: [ev(GeofenceKind.enter, t(12))],
        sets: [for (var h = 12; h <= 15; h++) SetMark(at: t(h, 45), insideFence: true)],
        now: now,
      );
      expect(s.single.end, t(16));
      expect(s.single.endReason, SessionEnd.cap);
    });

    test('진입을 놓치고 DWELL 만 오면 20분 전에 시작한 것으로 본다', () {
      final s = rules.sessions(events: [
        ev(GeofenceKind.dwell, t(18, 30)),
        ev(GeofenceKind.exit, t(19, 30)),
      ], now: now);
      expect(s.single.start, t(18, 10));
      expect(s.single.sawDwell, isTrue);
      expect(s.single.source, SessionSource.geofence);
    });

    test('진입을 놓쳐도 펜스 안 세트 기록이 세션을 연다(출처는 set)', () {
      final s = rules.sessions(
        events: const [],
        sets: [SetMark(at: t(18), insideFence: true)],
        now: now,
      );
      expect(s.single.source, SessionSource.set);
      expect(s.single.hasSet, isTrue);
    });

    test('펜스 밖 세트 기록은 체크인이 아니다', () {
      final s = rules.sessions(
        events: const [],
        sets: [SetMark(at: t(18), insideFence: false)],
        now: now,
      );
      expect(s, isEmpty);
    });

    test('짝 없는 이탈은 무시한다', () {
      final s = rules.sessions(events: [ev(GeofenceKind.exit, t(9))], now: now);
      expect(s, isEmpty);
    });

    test('진행 중 세션은 end 가 null', () {
      final s = rules.sessions(events: [ev(GeofenceKind.enter, t(22, 30, 9))], now: now);
      expect(s.single.end, isNull);
    });

    test('모의 위치 이벤트가 섞이면 세션에 표시된다', () {
      final s = rules.sessions(events: [
        ev(GeofenceKind.enter, t(18), mock: true),
        ev(GeofenceKind.exit, t(19)),
      ], now: now);
      expect(s.single.mock, isTrue);
    });
  });

  group('days + LoggingRate', () {
    test('지나가기만 한 날(20분 미만)은 방문일이 아니다', () {
      final s = rules.sessions(events: [
        ev(GeofenceKind.enter, t(18)),
        ev(GeofenceKind.exit, t(18, 5)),
      ], now: now);
      final d = rules.days(sessions: s, now: now);
      expect(d['2026-10-07']!.isVisit, isFalse);
    });

    // 분모 = 지오펜스 체류일 ∪ 자기보고 방문일. 두 기간 같은 규칙.
    final cases = <(String, List<GeofenceEvent>, List<SetMark>, SelfReport?, bool visit, bool recovered)>[
      ('지오펜스 체류', [ev(GeofenceKind.enter, t(18)), ev(GeofenceKind.exit, t(19))], [], null, true, false),
      ('지오펜스 놓침 + 자기보고 갔다', [], [], SelfReport(day: t(0), went: true), true, false),
      ('세트로만 복구', [], [SetMark(at: t(18), insideFence: true)], null, false, true),
      ('세트 복구 + 자기보고 갔다', [], [SetMark(at: t(18), insideFence: true)], SelfReport(day: t(0), went: true), true, false),
      ('자기보고 안 갔다만', [], [], SelfReport(day: t(0), went: false), false, false),
    ];
    for (final (name, events, sets, report, visit, recovered) in cases) {
      test(name, () {
        final s = rules.sessions(events: events, sets: sets, now: now);
        final d = rules.days(sessions: s, reports: [if (report != null) report], now: now);
        final day = d['2026-10-07']!;
        expect(day.isVisit, visit);
        expect(day.recoveredBySetOnly, recovered);
      });
    }

    test('사용 기간: 분자는 앱 세트 기록, 복구일은 분모 밖', () {
      final s = rules.sessions(
        events: [
          ev(GeofenceKind.enter, t(18, 0, 7)), ev(GeofenceKind.exit, t(19, 0, 7)),
          ev(GeofenceKind.enter, t(18, 0, 8)), ev(GeofenceKind.exit, t(19, 0, 8)),
        ],
        sets: [
          SetMark(at: t(18, 20, 7), insideFence: true),
          SetMark(at: t(18, 20, 9), insideFence: true), // 9일은 세트로만 복구
        ],
        now: now,
      );
      final rate = LoggingRate.of(rules.days(sessions: s, now: now).values, baseline: false);
      expect(rate.visitDays, 2);
      expect(rate.loggedDays, 1);
      expect(rate.recoveredBySetOnly, 1);
      expect(rate.rate, 0.5);
    });

    test('베이스라인: 분자는 수기 기록 자기보고, 충돌일 집계', () {
      final s = rules.sessions(events: [
        ev(GeofenceKind.enter, t(18, 0, 7)), ev(GeofenceKind.exit, t(19, 0, 7)),
      ], now: now);
      final d = rules.days(sessions: s, reports: [
        SelfReport(day: t(0, 0, 7), went: false, loggedByHand: false),
        SelfReport(day: t(0, 0, 8), went: true, loggedByHand: true),
      ], now: now);
      final rate = LoggingRate.of(d.values, baseline: true);
      expect(rate.visitDays, 2);
      expect(rate.loggedDays, 1);
      expect(rate.conflicts, 1);
    });

    test('방문일이 없으면 rate 는 null', () {
      expect(LoggingRate.of(const [], baseline: false).rate, isNull);
    });
  });

  completenessTests();
}

DayVisit _visit(String day, {bool visit = true}) => DayVisit(
      day: day,
      geofenceDwell: visit,
      selfReportWent: null,
      loggedByHand: null,
      hasSet: false,
      manual: false,
      mock: false,
    );

void completenessTests() {
  group('표본 날', () {
    // 2026-10-05 가 월요일.
    test('그 주 첫 방문일만 표본', () {
      final days = {
        '2026-10-06': _visit('2026-10-06'),
        '2026-10-08': _visit('2026-10-08'),
        '2026-10-12': _visit('2026-10-12'), // 다음 주 월요일
      };
      expect(isSampleDay('2026-10-06', days), isTrue);
      expect(isSampleDay('2026-10-08', days), isFalse);
      expect(isSampleDay('2026-10-12', days), isTrue);
    });

    test('방문일이 아니면 표본이 아니다', () {
      expect(isSampleDay('2026-10-06', {'2026-10-06': _visit('2026-10-06', visit: false)}), isFalse);
      expect(isSampleDay('2026-10-06', const {}), isFalse);
    });

    test('같은 주 앞선 날이 방문이 아니었으면 표본', () {
      final days = {
        '2026-10-05': _visit('2026-10-05', visit: false),
        '2026-10-07': _visit('2026-10-07'),
      };
      expect(isSampleDay('2026-10-07', days), isTrue);
    });
  });

  group('CompletenessRate', () {
    test('사용 기간: 앱 기록 세트 / 실제 세트, 초과분은 자른다', () {
      final r = CompletenessRate.of([
        SelfReport(day: DateTime(2026, 10, 6), went: true, actualSets: 20),
        SelfReport(day: DateTime(2026, 10, 13), went: true, actualSets: 10),
        SelfReport(day: DateTime(2026, 10, 14), went: true), // 표본 아님
      ], baseline: false, appSetsByDay: {'2026-10-06': 15, '2026-10-13': 12});
      expect((r.sampleDays, r.logged, r.actual), (2, 25, 30));
    });

    test('베이스라인: 수기 기록 세트 자기보고', () {
      final r = CompletenessRate.of([
        SelfReport(day: DateTime(2026, 10, 6), went: true, actualSets: 20, handLoggedSets: 5),
      ], baseline: true);
      expect(r.rate, 0.25);
    });

    test('표본이 없으면 rate 는 null', () {
      expect(CompletenessRate.of(const [], baseline: false).rate, isNull);
    });
  });
}
