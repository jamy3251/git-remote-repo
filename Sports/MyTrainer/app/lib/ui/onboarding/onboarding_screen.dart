import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../data/models.dart';
import '../../services/background_sync.dart';
import '../../services/location_access.dart';
import '../../services/reminders.dart';
import '../../state/attendance.dart';
import '../widgets/panel.dart';

/// 처음 한 번. 위치 권한 → 헬스장 등록 → 밤 알림.
///
/// 헬스장 등록은 반드시 헬스장 안에서 한다. 30초 동안 위치를 모아 평균을 낸다.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  LocationAccess? _access;
  Gym? _gym;
  double _radius = 80;
  double? _sampling; // null 이면 측정 중 아님
  int _samples = 0;
  bool _saving = false;
  String? _error;

  Future<void> _askLocation() async {
    final svc = ref.read(locationAccessServiceProvider);
    final access = await svc.request();
    setState(() => _access = access);
    ref.invalidate(locationAccessProvider);
  }

  Future<void> _measure() async {
    setState(() {
      _sampling = 0;
      _samples = 0;
      _error = null;
    });
    try {
      final gym = await ref.read(locationAccessServiceProvider).sampleGymCenter(
            onProgress: (p, n) => setState(() {
              _sampling = p;
              _samples = n;
            }),
          );
      setState(() => _gym = gym);
    } catch (e) {
      setState(() => _error = '위치를 받지 못했어요. 위치가 켜져 있는지 확인해 주세요.');
    } finally {
      setState(() => _sampling = null);
    }
  }

  Future<void> _finish() async {
    final gym = _gym;
    setState(() => _saving = true);
    // 위치를 거부한 사람은 헬스장 없이 시작한다. 밤 질문·수동 체크인으로 출석을 받는다.
    if (gym != null) {
      final saved = Gym(lat: gym.lat, lng: gym.lng, radiusM: _radius);
      await ref.read(repositoryProvider).saveGym(saved);
      try {
        if (_access == LocationAccess.always) {
          await ref.read(geofenceServiceProvider).register(saved);
        }
      } catch (e) {
        // 등록이 실패해도 수동 출석·밤 질문으로 계속 쓸 수 있다.
        debugPrint('지오펜스 등록 실패: $e');
      }
    }
    await Reminders.instance.requestPermission();
    await Reminders.instance.scheduleNightly();
    await BackgroundSync.schedule();
    await ref.read(sharedPreferencesProvider).setBool('mytrainer.onboarded', true);
    ref.read(onboardedProvider.notifier).state = true;
    ref.invalidate(attendanceProvider);
    if (mounted) context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final access = _access;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.huge, Gap.xl, Gap.huge),
          children: [
            const Text('헬스장에 가면\n출석이 알아서 찍혀요', style: AppText.display),
            const SizedBox(height: Gap.md),
            Text(
              '처음 2주는 출석만 모아요. 지금 운동 기록을 얼마나 빠뜨리는지 재기 위해서예요.',
              style: AppText.body.copyWith(color: AppColors.inkSub),
            ),
            const SizedBox(height: Gap.xxl),
            _Step(
              index: 1,
              title: '위치 권한',
              done: access != null && access != LocationAccess.denied,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '앱을 꺼 둬도 출석이 찍히려면 "항상 허용"이 필요해요. '
                    '거부해도 매일 밤 한 번 묻는 방식으로 쓸 수 있어요.',
                    style: AppText.caption,
                  ),
                  const SizedBox(height: Gap.md),
                  if (access == null)
                    FilledButton(onPressed: _askLocation, child: const Text('위치 권한 허용하기'))
                  else
                    _AccessNote(access: access, onSettings: () async {
                      await ref.read(locationAccessServiceProvider).openSettings();
                    }, onRecheck: () async {
                      final a = await ref.read(locationAccessServiceProvider).status();
                      setState(() => _access = a);
                    }),
                ],
              ),
            ),
            const SizedBox(height: Gap.lg),
            _Step(
              index: 2,
              title: '헬스장 등록',
              done: _gym != null,
              enabled: access != null && access != LocationAccess.denied,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('헬스장 안에서 눌러 주세요. 30초 동안 위치를 모아 평균을 내요.',
                      style: AppText.caption),
                  const SizedBox(height: Gap.md),
                  if (_sampling != null) ...[
                    LinearProgressIndicator(value: _sampling, minHeight: 6),
                    const SizedBox(height: Gap.sm),
                    Text('위치 $_samples개 받는 중', style: AppText.caption),
                  ] else if (_gym == null)
                    FilledButton(onPressed: _measure, child: const Text('여기가 내 헬스장이에요'))
                  else ...[
                    Text('등록할 위치를 찾았어요', style: AppText.bodyStrong),
                    const SizedBox(height: Gap.md),
                    Text('반경 ${_radius.round()}m', style: AppText.label),
                    Slider(
                      value: _radius,
                      min: 50,
                      max: 200,
                      divisions: 15,
                      onChanged: (v) => setState(() => _radius = v),
                    ),
                    Text('건물이 크거나 지하면 넓게 잡아 주세요.', style: AppText.caption),
                    TextButton(onPressed: _measure, child: const Text('다시 측정')),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Gap.sm),
                      child: Text(_error!, style: AppText.caption.copyWith(color: AppColors.coral)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: Gap.xxl),
            FilledButton(
              onPressed: (_gym != null || access == LocationAccess.denied) && !_saving ? _finish : null,
              child: Text(_saving ? '저장 중' : '시작하기'),
            ),
            const SizedBox(height: Gap.md),
            Text('매일 밤 9시 반에 "오늘 헬스장 갔나요?" 알림이 한 번 와요.',
                style: AppText.caption, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.index,
    required this.title,
    required this.done,
    required this.child,
    this.enabled = true,
  });

  final int index;
  final String title;
  final bool done;
  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) => Opacity(
        opacity: enabled ? 1 : 0.45,
        child: IgnorePointer(
          ignoring: !enabled,
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text('$index', style: AppText.labelStrong.copyWith(color: AppColors.teal)),
                  const SizedBox(width: Gap.sm),
                  Expanded(child: Text(title, style: AppText.section)),
                  if (done) const Icon(Icons.check, size: 18, color: AppColors.teal),
                ]),
                const SizedBox(height: Gap.sm),
                child,
              ],
            ),
          ),
        ),
      );
}

class _AccessNote extends StatelessWidget {
  const _AccessNote({required this.access, required this.onSettings, required this.onRecheck});

  final LocationAccess access;
  final VoidCallback onSettings;
  final VoidCallback onRecheck;

  @override
  Widget build(BuildContext context) {
    final (text, color) = switch (access) {
      LocationAccess.always => ('항상 허용됨. 자동 출석이 켜져요.', AppColors.teal),
      LocationAccess.whileInUse => ('앱 사용 중에만 허용됨. 자동 출석은 꺼지고 밤 질문으로 출석을 받아요.', AppColors.amber),
      LocationAccess.denied => ('거부됨. 밤 질문과 수동 체크인으로 출석을 받아요.', AppColors.coral),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(text, style: AppText.caption.copyWith(color: color)),
        if (access != LocationAccess.always)
          Row(children: [
            TextButton(onPressed: onSettings, child: const Text('설정에서 항상 허용')),
            TextButton(onPressed: onRecheck, child: const Text('다시 확인')),
          ]),
      ],
    );
  }
}
