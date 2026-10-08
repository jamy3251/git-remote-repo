import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 새 버전이 나왔는지 보고, 받아서 설치까지 이어준다.
///
/// 스토어에 안 올린 앱이라 폰이 알아서 갱신해 주지 않는다. 그래서 앱이 직접
/// 확인한다. 만든 사람이 새 APK 를 올리면 친구 폰이 다음에 켤 때 안내를 띄운다.
///
/// **완전 무인 설치는 안 된다.** 안드로이드는 출처를 알 수 없는 설치에 반드시
/// 사용자 확인을 요구한다(기기 관리자 앱이 아닌 이상). 여기서 할 수 있는 건
/// "받아다 설치 화면까지 열어주기"까지고, 마지막 '설치' 한 번은 사람이 누른다.
class Updater {
  Updater._();
  static final instance = Updater._();

  /// 배포 위치. GitHub Releases 의 최신 릴리스에 붙는 고정 주소다.
  ///
  /// Firebase Hosting 은 무료 요금제에서 실행파일(APK)을 거부해서 GitHub 로 갔다.
  /// `latest/download` 는 버전이 올라가도 주소가 안 바뀐다.
  static const manifestUrl =
      'https://github.com/jamy3251/mytrainer-releases/releases/latest/download/version.json';

  static const _lastCheckKey = 'mytrainer.update.lastCheck';

  /// 매번 켤 때마다 확인하면 요금제 전송량만 축낸다.
  static const _interval = Duration(hours: 6);

  /// 지금 깔려 있는 빌드 번호. pubspec 의 `+숫자`.
  int _currentBuild = 0;
  String _currentName = '';

  int get currentBuild => _currentBuild;
  String get currentName => _currentName;

  Future<void> init() async {
    try {
      final info = await PackageInfo.fromPlatform();
      _currentBuild = int.tryParse(info.buildNumber) ?? 0;
      _currentName = info.version;
    } catch (e) {
      debugPrint('버전 정보를 못 읽었어요: $e');
    }
  }

  /// 새 버전이 있으면 정보를, 없으면 null.
  ///
  /// [force] 가 false 면 마지막 확인으로부터 [_interval] 이 지나야 실제로 조회한다.
  Future<AppRelease?> check({bool force = false}) async {
    if (_currentBuild == 0) await init();

    final prefs = await SharedPreferences.getInstance();
    final last = prefs.getInt(_lastCheckKey) ?? 0;
    final elapsed =
        DateTime.now().millisecondsSinceEpoch - last;

    if (!force && elapsed < _interval.inMilliseconds) return null;

    try {
      final res = await http
          .get(Uri.parse('$manifestUrl?t=${DateTime.now().millisecondsSinceEpoch}'))
          .timeout(const Duration(seconds: 10));

      await prefs.setInt(
          _lastCheckKey, DateTime.now().millisecondsSinceEpoch);

      if (res.statusCode != 200) return null;

      final json =
          jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
      final release = AppRelease.fromJson(json);

      if (release.build <= _currentBuild) return null;
      return release;
    } catch (e) {
      // 인터넷이 없거나 아직 아무것도 안 올렸을 때. 조용히 넘어간다.
      debugPrint('업데이트 확인 실패: $e');
      return null;
    }
  }

  /// APK 를 받아 설치 화면을 연다.
  ///
  /// [onProgress] 는 0~1. 26MB 라 진행률이 없으면 멈춘 줄 안다.
  Future<String?> download(
    AppRelease release, {
    void Function(double progress)? onProgress,
  }) async {
    try {
      final dir = await getApplicationSupportDirectory();
      final file = File('${dir.path}/mytrainer-${release.build}.apk');

      // 받다 만 게 남아 있으면 지우고 새로 받는다.
      if (file.existsSync()) await file.delete();

      final client = http.Client();
      final request = http.Request('GET', Uri.parse(release.url));
      final response = await client.send(request);

      if (response.statusCode != 200) {
        client.close();
        return '내려받지 못했어요 (${response.statusCode})';
      }

      final total = response.contentLength ?? 0;
      var received = 0;
      final sink = file.openWrite();

      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress?.call(received / total);
      }

      await sink.close();
      client.close();

      final result = await OpenFilex.open(file.path);
      if (result.type != ResultType.done) {
        return '설치 화면을 열지 못했어요. 설정에서 "출처를 알 수 없는 앱 설치"를 허용해 주세요.';
      }
      return null;
    } catch (e) {
      debugPrint('업데이트 내려받기 실패: $e');
      return '내려받는 중 문제가 생겼어요';
    }
  }
}

/// 올라와 있는 새 버전.
@immutable
class AppRelease {
  const AppRelease({
    required this.build,
    required this.name,
    required this.url,
    this.notes = '',
    this.mandatory = false,
  });

  /// pubspec 의 `+숫자`. 이걸로 크고 작음을 따진다.
  final int build;

  /// 0.2.0 처럼 사람이 읽는 버전
  final String name;

  final String url;

  /// 무엇이 바뀌었는지. 한 줄씩.
  final String notes;

  /// true 면 나중에 하기를 막는다. 데이터 구조가 바뀐 경우에만 쓴다.
  final bool mandatory;

  factory AppRelease.fromJson(Map<String, dynamic> j) => AppRelease(
        build: (j['build'] as num?)?.toInt() ?? 0,
        name: j['name'] as String? ?? '',
        url: j['url'] as String? ?? '',
        notes: j['notes'] as String? ?? '',
        mandatory: j['mandatory'] as bool? ?? false,
      );
}
