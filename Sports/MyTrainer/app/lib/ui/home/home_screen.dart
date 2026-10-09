import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../data/models.dart';
import '../../party/party_state.dart';
import '../../spotter/spot_repository.dart';
import '../../services/location_access.dart';
import '../../services/reminders.dart';
import '../../services/session_rules.dart';
import '../../state/attendance.dart';
import '../spotter/spot_confirm_screen.dart';
import '../widgets/panel.dart';

/// 출석 전용 모드(베이스라인) 홈.
///
/// 하는 일은 셋뿐이다. 오늘 출석이 찍혔는지 보여주고, 밤에 "갔나요? / 수기로
/// 기록했나요?"를 한 번씩 받고, 자동 출석이 꺼진 사람에게 수동 체크인을 준다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ensureGeofence(ref);
    // 화면을 먼저 그리고 뒤에서 받는다. 6시간 안에 받았으면 건너뛴다.
    Future.microtask(() => ref.read(offlineStatusProvider.notifier).prepare());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // 설정에서 권한을 바꾸고 돌아오거나, 헬스장에서 앱을 열 때 바로 반영한다.
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(locationAccessProvider);
      ensureGeofence(ref);
      ref.read(attendanceProvider.notifier).refresh();
      ref.read(offlineStatusProvider.notifier).prepare();
    }
  }

  @override
  Widget build(BuildContext context) {
    final attendance = ref.watch(attendanceProvider);
    final access = ref.watch(locationAccessProvider).valueOrNull;
    final phase = ref.watch(studyPhaseProvider);

    // 앱이 켜져 있을 때 새 스포터 결과가 오면 알린다(서버 푸시 없음, D4). 첫 로드는 배너로 충분.
    ref.listen(incomingSpotsProvider, (prev, next) {
      final before = prev?.valueOrNull;
      final now = next.valueOrNull;
      if (before == null || now == null) return;
      final seen = before.map((s) => s.id).toSet();
      final names = ref.read(partyViewProvider).valueOrNull;
      for (final s in now.where((s) => !seen.contains(s.id))) {
        ref.read(spotNotifierProvider)(
          s.id.hashCode,
          '${names?.nameOf(s.spotterId) ?? '파티원'}님이 스쿼트 ${s.reps}회를 찍었어요',
          '무게를 넣고 저장하면 기록돼요. 24시간 안에 확인해 주세요.',
        );
      }
    });

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => Future.wait([
            ref.read(attendanceProvider.notifier).refresh(),
            ref.read(offlineStatusProvider.notifier).prepare(force: true),
          ]),
          child: attendance.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ListView(children: [
              Padding(
                padding: const EdgeInsets.all(Gap.xl),
                child: Text('출석을 불러오지 못했어요. 당겨서 다시 시도해 주세요.\n$e',
                    style: AppText.body),
              ),
            ]),
            data: (s) => ListView(
              padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.xl, Gap.xl, Gap.huge),
              children: [
                Row(children: [
                  Expanded(
                    child: Text(DateFormat('M월 d일 EEEE', 'ko_KR').format(s.now),
                        style: AppText.label.copyWith(color: AppColors.inkSub)),
                  ),
                  IconButton(
                    tooltip: '파티',
                    onPressed: () => context.push('/party'),
                    icon: const Icon(Icons.group_outlined, color: AppColors.inkSub),
                  ),
                ]),
                const SizedBox(height: Gap.xs),
                GestureDetector(
                  // 진행자용: 베이스라인이 끝나면 여기서 기록 모드로 바꾼다.
                  onLongPress: () => _pickPhase(context, ref, phase),
                  child: Text(phase == StudyPhase.baseline ? '오늘 출석' : '오늘', style: AppText.display),
                ),
                const SizedBox(height: Gap.lg),
                const _IncomingSpots(),
                if (phase == StudyPhase.logging) ...[
                  SizedBox(
                    height: 56,
                    child: FilledButton(
                      onPressed: () => context.push('/log'),
                      child: Text('운동 기록하기', style: AppText.section.copyWith(color: Colors.white)),
                    ),
                  ),
                  const SizedBox(height: Gap.sm),
                  OutlinedButton.icon(
                    onPressed: () => context.push('/spotter'),
                    icon: const Icon(Icons.videocam_outlined),
                    label: const Text('스포터 모드 · 친구 스쿼트 세기'),
                  ),
                  const SizedBox(height: Gap.md),
                ],
                if (access != null && access != LocationAccess.always) ...[
                  _AccessBanner(access: access),
                  const SizedBox(height: Gap.md),
                ],
                _TodayCard(state: s, autoOn: access == LocationAccess.always),
                const SizedBox(height: Gap.md),
                _QuestionCard(state: s, baseline: phase == StudyPhase.baseline),
                const SizedBox(height: Gap.md),
                _RecentCard(state: s, baseline: phase == StudyPhase.baseline),
                const SizedBox(height: Gap.xl),
                _OfflineLine(now: s.now),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _pickPhase(BuildContext context, WidgetRef ref, StudyPhase current) async {
  final picked = await showDialog<StudyPhase>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: const Text('측정 단계'),
      children: [
        for (final (p, label) in [
          (StudyPhase.baseline, '베이스라인 (출석만, 수기 기록 질문)'),
          (StudyPhase.logging, '사용 기간 (앱으로 기록)'),
        ])
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, p),
            child: Text(p == current ? '$label  · 현재' : label),
          ),
      ],
    ),
  );
  if (picked != null && picked != current) await setStudyPhase(ref, picked);
}

/// 알림 띄우기. 테스트에서 바꿔 끼운다.
final spotNotifierProvider =
    Provider<Future<void> Function(int, String, String)>((_) => Reminders.instance.showSpot);

/// 친구가 찍어 보낸 스쿼트, 확인 대기.
class _IncomingSpots extends ConsumerWidget {
  const _IncomingSpots();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spots = ref.watch(incomingSpotsProvider).valueOrNull ?? const <PendingSpot>[];
    if (spots.isEmpty) return const SizedBox.shrink();
    final names = ref.watch(partyViewProvider).valueOrNull;
    final now = DateTime.now();
    return Column(children: [
      for (final s in spots)
        Padding(
          padding: const EdgeInsets.only(bottom: Gap.md),
          child: Panel(
            color: AppColors.tealSoft,
            padding: const EdgeInsets.all(Gap.lg),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${names?.nameOf(s.spotterId) ?? '파티원'}님이 스쿼트 ${s.reps}회를 찍었어요',
                      style: AppText.bodyStrong),
                  Text(
                    '${s.createdAt.add(PendingSpot.ttl).difference(now).inHours}시간 안에 확인하면 기록돼요',
                    style: AppText.caption,
                  ),
                ]),
              ),
              FilledButton(
                onPressed: () => context.push('/spots/confirm', extra: SpotDraft.fromSpot(s)),
                child: const Text('확인'),
              ),
            ]),
          ),
        ),
    ]);
  }
}

/// 헬스장(지하)에 들어가기 전에 볼 한 줄. 준비가 안 됐으면 눈에 띄게(설계 D13).
class _OfflineLine extends ConsumerWidget {
  const _OfflineLine({required this.now});

  final DateTime now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(offlineStatusProvider).valueOrNull;
    if (st == null) return const SizedBox.shrink();
    final pending = st.pendingUploads > 0 ? ' · 올리기 전 ${st.pendingUploads}건' : '';

    if (st.local) {
      return _line('이 폰에만 저장 중', AppColors.inkFaint);
    }
    if (st.isReady(now)) {
      final at = st.readyAt!;
      final when = dayKey(at) == dayKey(now)
          ? DateFormat('HH:mm').format(at)
          : DateFormat('M월 d일 HH:mm').format(at);
      return _line('오프라인 준비됨 · $when$pending', AppColors.inkFaint);
    }

    final String head;
    if (st.readyAt == null) {
      head = '오프라인 준비 안 됨';
    } else if (st.missing.isNotEmpty) {
      head = '오프라인 준비 덜 됨(${st.missing.join(', ')})';
    } else {
      head = '오프라인 준비가 ${now.difference(st.readyAt!).inDays}일 지났어요';
    }
    return Panel(
      color: AppColors.amberSoft,
      padding: const EdgeInsets.all(Gap.lg),
      child: Text(
        '$head$pending\n인터넷이 되는 곳에서 화면을 당겨 새로고침해 주세요. 지하에서도 기록이 미리 채워져요.',
        style: AppText.caption.copyWith(color: AppColors.ink),
      ),
    );
  }

  Widget _line(String text, Color color) =>
      Text(text, style: AppText.micro.copyWith(color: color), textAlign: TextAlign.center);
}

String _stay(Duration d) {
  final h = d.inHours, m = d.inMinutes % 60;
  if (h == 0) return '$m분';
  return m == 0 ? '$h시간' : '$h시간 $m분';
}

class _TodayCard extends ConsumerWidget {
  const _TodayCard({required this.state, required this.autoOn});

  final AttendanceState state;
  final bool autoOn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final open = state.openSession;
    final today = state.todaySessions;
    final hhmm = DateFormat('HH:mm');

    final String headline;
    final String sub;
    if (open != null && state.todayKey == dayKey(open.start)) {
      headline = '헬스장에 있어요';
      sub = '${hhmm.format(open.start)}부터 · ${_stay(state.todayStay)}';
    } else if (today.isNotEmpty) {
      headline = '${_stay(state.todayStay)} 머물렀어요';
      sub = today.map((s) => '${hhmm.format(s.start)}–${s.end == null ? '' : hhmm.format(s.end!)}').join(', ');
    } else {
      headline = '아직 출석이 없어요';
      sub = autoOn
          ? (state.gym == null ? '헬스장이 등록되지 않았어요' : '헬스장에 들어가면 자동으로 찍혀요')
          : '헬스장에 왔다면 아래 버튼을 눌러 주세요';
    }

    final tags = <String>[
      if (today.any((s) => s.source == SessionSource.geofence)) '자동',
      if (today.any((s) => s.manual)) '수동',
      if (today.any((s) => s.mock)) '위치 확인 안 됨',
    ];

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(headline, style: AppText.title),
          const SizedBox(height: Gap.xs),
          Text(sub, style: AppText.body.copyWith(color: AppColors.inkSub)),
          if (tags.isNotEmpty) ...[
            const SizedBox(height: Gap.md),
            Wrap(spacing: Gap.sm, children: [for (final t in tags) _Tag(t)]),
          ],
          if (open == null) ...[
            const SizedBox(height: Gap.md),
            OutlinedButton(
              onPressed: () => ref.read(attendanceProvider.notifier).manualCheckIn(),
              child: const Text('지금 헬스장이에요'),
            ),
          ],
        ],
      ),
    );
  }
}

class _QuestionCard extends ConsumerWidget {
  const _QuestionCard({required this.state, required this.baseline});

  final AttendanceState state;
  final bool baseline;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final report = state.todayReport;
    final ctrl = ref.read(attendanceProvider.notifier);

    // 저녁 전에는 출석이 찍힌 날만 묻는다. 운동 전인데 "안 갔다"를 받지 않으려고.
    final evening = state.now.hour >= 20;
    if (report == null && !evening && state.todaySessions.isEmpty) {
      return const SizedBox.shrink();
    }

    Widget twoButtons(String yes, String no, ValueChanged<bool> onPick, bool? picked) => Row(
          children: [
            Expanded(
              child: picked == true
                  ? FilledButton(onPressed: () => onPick(true), child: Text(yes))
                  : OutlinedButton(onPressed: () => onPick(true), child: Text(yes)),
            ),
            const SizedBox(width: Gap.sm),
            Expanded(
              child: picked == false
                  ? FilledButton(onPressed: () => onPick(false), child: Text(no))
                  : OutlinedButton(onPressed: () => onPick(false), child: Text(no)),
            ),
          ],
        );

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PanelLabel('오늘 확인'),
          const Text('오늘 헬스장 갔나요?', style: AppText.section),
          const SizedBox(height: Gap.md),
          twoButtons('갔어요', '안 갔어요', ctrl.answerWent, report?.went),
          if (baseline && report?.went == true) ...[
            const SizedBox(height: Gap.lg),
            const Text('오늘 운동을 수기로 기록했나요?', style: AppText.section),
            const SizedBox(height: Gap.xs),
            Text('메모장·노트 무엇이든요. 일부만 적었어도 "기록했어요".',
                style: AppText.caption),
            const SizedBox(height: Gap.md),
            twoButtons('기록했어요', '못 했어요', ctrl.answerLoggedByHand, report?.loggedByHand),
          ],
          if (report?.went == true && state.todayIsSample) ...[
            const SizedBox(height: Gap.lg),
            _SetCountQuestion(state: state, baseline: baseline),
          ],
        ],
      ),
    );
  }
}

class _RecentCard extends StatelessWidget {
  const _RecentCard({required this.state, required this.baseline});

  final AttendanceState state;
  final bool baseline;

  @override
  Widget build(BuildContext context) {
    const n = 14;
    final keys = state.recentDays(n);
    final rate = state.rateFor(n, baseline: baseline);

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PanelLabel('최근 2주'),
          Text(
            rate.visitDays == 0
                ? '아직 방문한 날이 없어요'
                : '방문 ${rate.visitDays}일 중 기록 ${rate.loggedDays}일',
            style: AppText.section,
          ),
          if (state.completenessFor(n, baseline: baseline) case final c when c.rate != null)
            Padding(
              padding: const EdgeInsets.only(top: Gap.xs),
              child: Text(
                '표본 ${c.sampleDays}일 세트 완결도 ${(c.rate! * 100).round()}% (${c.logged}/${c.actual}세트)',
                style: AppText.caption,
              ),
            ),
          const SizedBox(height: Gap.md),
          Row(
            children: [
              for (final k in keys)
                Expanded(child: _DayDot(day: state.days[k], baseline: baseline)),
            ],
          ),
          const SizedBox(height: Gap.sm),
          Row(children: [
            _Legend(color: AppColors.teal, text: '방문·기록'),
            const SizedBox(width: Gap.md),
            _Legend(color: AppColors.tealLine, text: '방문'),
          ]),
        ],
      ),
    );
  }
}

class _DayDot extends StatelessWidget {
  const _DayDot({required this.day, required this.baseline});

  final DayVisit? day;
  final bool baseline;

  @override
  Widget build(BuildContext context) {
    final d = day;
    final logged = d != null && (baseline ? d.loggedByHand == true : d.hasSet);
    final color = d == null || !d.isVisit
        ? AppColors.lineSoft
        : (logged ? AppColors.teal : AppColors.tealLine);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: AspectRatio(
        aspectRatio: 1,
        child: DecoratedBox(
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.text});
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Row(children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: Gap.xs),
        Text(text, style: AppText.micro.copyWith(color: AppColors.inkSub)),
      ]);
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: Gap.sm, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.surfaceAlt,
          borderRadius: BorderRadius.circular(Radii.small),
        ),
        child: Text(text, style: AppText.micro.copyWith(color: AppColors.inkSub)),
      );
}

class _AccessBanner extends ConsumerWidget {
  const _AccessBanner({required this.access});
  final LocationAccess access;

  @override
  Widget build(BuildContext context, WidgetRef ref) => Panel(
        color: AppColors.amberSoft,
        padding: const EdgeInsets.all(Gap.lg),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '자동 출석이 꺼져 있어요. 위치를 "항상 허용"으로 바꾸면 앱을 열지 않아도 찍혀요.',
                style: AppText.caption.copyWith(color: AppColors.ink),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(locationAccessServiceProvider).openSettings(),
              child: const Text('설정'),
            ),
          ],
        ),
      );
}

/// 주 1회 표본 날에만. 운동 직후 실제로 한 세트 수(설계 D11).
class _SetCountQuestion extends ConsumerStatefulWidget {
  const _SetCountQuestion({required this.state, required this.baseline});

  final AttendanceState state;
  final bool baseline;

  @override
  ConsumerState<_SetCountQuestion> createState() => _SetCountQuestionState();
}

class _SetCountQuestionState extends ConsumerState<_SetCountQuestion> {
  late int _actual = widget.state.todayReport?.actualSets ?? (widget.baseline ? 15 : widget.state.todayAppSets);
  late int _hand = widget.state.todayReport?.handLoggedSets ?? 0;

  Widget _count(String label, int value, ValueChanged<int> onChanged) => Row(children: [
        Expanded(child: Text(label, style: AppText.body)),
        IconButton.outlined(onPressed: () => onChanged((value - 1).clamp(0, 99)), icon: const Icon(Icons.remove)),
        SizedBox(width: 48, child: Text('$value', style: AppText.title, textAlign: TextAlign.center)),
        IconButton.outlined(onPressed: () => onChanged((value + 1).clamp(0, 99)), icon: const Icon(Icons.add)),
      ]);

  @override
  Widget build(BuildContext context) {
    final saved = widget.state.todayReport?.actualSets != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('이번 주 확인: 오늘 실제로 몇 세트 했나요?', style: AppText.section),
        const SizedBox(height: Gap.xs),
        Text(
          widget.baseline
              ? '워밍업 빼고 본 세트만 세어 주세요. 그중 수기로 적은 세트 수도 함께요.'
              : '워밍업 빼고 본 세트만 세어 주세요. 앱에 기록한 수(${widget.state.todayAppSets})와 비교해요.',
          style: AppText.caption,
        ),
        const SizedBox(height: Gap.md),
        _count('실제로 한 세트', _actual, (v) => setState(() => _actual = v)),
        if (widget.baseline) ...[
          const SizedBox(height: Gap.sm),
          _count('그중 수기로 적은 세트', _hand, (v) => setState(() => _hand = v.clamp(0, _actual))),
        ],
        const SizedBox(height: Gap.md),
        OutlinedButton(
          onPressed: () => ref.read(attendanceProvider.notifier).answerSetCounts(
                actual: _actual,
                handLogged: widget.baseline ? _hand.clamp(0, _actual) : null,
              ),
          child: Text(saved ? '저장됨 · 다시 저장' : '저장'),
        ),
      ],
    );
  }
}
