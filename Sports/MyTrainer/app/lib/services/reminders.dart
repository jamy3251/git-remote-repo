import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// 매일 밤 "오늘 헬스장 갔나요?" 알림.
///
/// 지오펜스와 독립된 방문 기록(자기보고)을 받기 위한 것이다. 답은 앱 홈의
/// 카드에서 한 번 탭으로 받는다. 알림을 놓쳐도 다음에 앱을 열면 카드가 남아 있다.
class Reminders {
  Reminders._();
  static final instance = Reminders._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  static const _nightlyId = 2130;

  /// 운동이 끝났을 시간. 대부분 21시 전에 헬스장을 나온다.
  static const nightlyHour = 21;
  static const nightlyMinute = 30;

  static const _channel = AndroidNotificationChannel(
    'mytrainer_nightly',
    '오늘 출석 확인',
    description: '하루 한 번, 오늘 헬스장에 갔는지 묻습니다',
    importance: Importance.defaultImportance,
  );

  static const _spotChannel = AndroidNotificationChannel(
    'mytrainer_spots',
    '스포터 결과',
    description: '친구가 찍어 보낸 반복 수를 확인해 달라는 알림',
    importance: Importance.high,
  );

  Future<void> init() async {
    if (_ready) return;
    try {
      tzdata.initializeTimeZones();
      // 테스트 참여자가 모두 한국에 있다.
      tz.setLocalLocation(tz.getLocation('Asia/Seoul'));
      await _plugin.initialize(const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ));
      await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);
      await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_spotChannel);
      _ready = true;
    } catch (e) {
      debugPrint('알림 초기화 실패: $e');
    }
  }

  Future<bool> requestPermission() async {
    await init();
    final android =
        _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await android?.requestNotificationsPermission() ?? false;
  }

  /// 매일 같은 시각에 반복. 여러 번 불러도 같은 id 라 하나만 남는다.
  Future<void> scheduleNightly() async {
    await init();
    if (!_ready) return;
    final now = tz.TZDateTime.now(tz.local);
    var at = tz.TZDateTime(tz.local, now.year, now.month, now.day, nightlyHour, nightlyMinute);
    if (!at.isAfter(now)) at = at.add(const Duration(days: 1));
    try {
      await _plugin.zonedSchedule(
        _nightlyId,
        '오늘 헬스장 갔나요?',
        '한 번만 눌러 주세요. 기록 누락률을 재는 데 씁니다.',
        at,
        NotificationDetails(
          android: AndroidNotificationDetails(_channel.id, _channel.name,
              channelDescription: _channel.description),
        ),
        // 정확한 알람 권한 없이도 되는 방식. 몇 분 늦어도 괜찮다.
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        uiLocalNotificationDateInterpretation: UILocalNotificationDateInterpretation.absoluteTime,
        matchDateTimeComponents: DateTimeComponents.time,
      );
    } catch (e) {
      debugPrint('밤 알림 예약 실패: $e');
    }
  }

  /// 앱이 켜져 있을 때 스포터 결과가 오면 바로 띄운다(서버 푸시 없음, D4).
  Future<void> showSpot(int id, String title, String body) async {
    await init();
    if (!_ready) return;
    try {
      await _plugin.show(
        id,
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(_spotChannel.id, _spotChannel.name,
              channelDescription: _spotChannel.description, importance: Importance.high),
        ),
      );
    } catch (e) {
      debugPrint('스포터 알림 실패: $e');
    }
  }
}
