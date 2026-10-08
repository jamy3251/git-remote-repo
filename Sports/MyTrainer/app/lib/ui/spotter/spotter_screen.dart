import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../data/exercises.dart';
import '../../party/party_repository.dart';
import '../../party/party_state.dart';
import '../../spotter/pose_source.dart';
import '../../spotter/recording.dart';
import '../../spotter/rep_counter.dart';
import '../../spotter/spotter_state.dart';
import '../widgets/panel.dart';
import 'spot_confirm_screen.dart';

/// 스포터 모드(스쿼트 1종목, 설계 §4): 리프터 고르기 → 촬영하며 반복 수 세기 → 확인 후 보내기.
///
/// 영상은 저장하지도 올리지도 않는다. 보내는 것은 종목·반복 수·촬영자·시각뿐이다.
class SpotterScreen extends ConsumerStatefulWidget {
  const SpotterScreen({super.key});

  @override
  ConsumerState<SpotterScreen> createState() => _SpotterScreenState();
}

/// 삼각대에 폰을 세워 내가 찍는 경우.
const _self = Member(uid: '', displayName: '나 (삼각대로 직접)');

class _SpotterScreenState extends ConsumerState<SpotterScreen> {
  Member? _lifter;
  PoseRecording? _result;

  @override
  Widget build(BuildContext context) {
    if (_lifter == null) return _PickLifter(onPick: (m) => setState(() => _lifter = m));
    if (_result == null) {
      return _Record(lifter: _lifter!, onDone: (r) => setState(() => _result = r));
    }
    return _Result(lifter: _lifter!, recording: _result!);
  }
}

class _PickLifter extends ConsumerWidget {
  const _PickLifter({required this.onPick});

  final ValueChanged<Member> onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(partyViewProvider).valueOrNull;
    final others = view?.others ?? const [];
    return Scaffold(
      appBar: AppBar(title: const Text('스포터 모드')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          const Text('누구의 스쿼트를 찍을까요?', style: AppText.title),
          const SizedBox(height: Gap.xs),
          const Text('옆에서 머리부터 발끝까지 나오게, 2~3m 떨어져서 찍어요. 영상은 남기지 않아요.',
              style: AppText.caption),
          const SizedBox(height: Gap.lg),
          for (final m in others)
            Card(
              elevation: 0,
              color: AppColors.surfaceAlt,
              child: ListTile(
                title: Text(m.displayName, style: AppText.bodyStrong),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => onPick(m),
              ),
            ),
          if (others.isEmpty)
            Panel(
              color: AppColors.amberSoft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('파티에 다른 사람이 없어요. 친구에게 초대 코드를 보내 주세요.', style: AppText.body),
                  TextButton(onPressed: () => context.push('/party'), child: const Text('파티 열기')),
                ],
              ),
            ),
          const SizedBox(height: Gap.sm),
          OutlinedButton(onPressed: () => onPick(_self), child: Text(_self.displayName)),
        ],
      ),
    );
  }
}

class _Record extends ConsumerStatefulWidget {
  const _Record({required this.lifter, required this.onDone});

  final Member lifter;
  final ValueChanged<PoseRecording> onDone;

  @override
  ConsumerState<_Record> createState() => _RecordState();
}

class _RecordState extends ConsumerState<_Record> {
  late final PoseSource _source = ref.read(poseSourceFactoryProvider)();
  late RepCounter _counter = RepCounter(ref.read(repCounterConfigProvider));
  final _frames = <PoseFrame>[];
  StreamSubscription<PoseFrame>? _sub;
  bool _ready = false;
  bool _counting = false;
  String? _error;

  /// 최근 1초 사이 다리가 안 보인 프레임 비율이 높으면 안내한다.
  final _recentSeen = <bool>[];

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      await _source.start();
      _sub = _source.frames.listen(_onFrame);
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      if (mounted) setState(() => _error = '카메라를 열지 못했어요. 카메라 권한을 확인해 주세요.\n$e');
    }
  }

  void _onFrame(PoseFrame f) {
    if (!_counting) return;
    final ignoredBefore = _counter.framesIgnored;
    _counter.feed(f);
    _frames.add(f);
    _recentSeen.add(_counter.framesIgnored == ignoredBefore);
    if (_recentSeen.length > 15) _recentSeen.removeAt(0);
    if (mounted) setState(() {});
  }

  void _begin() => setState(() {
        _counter = RepCounter(ref.read(repCounterConfigProvider));
        _frames.clear();
        _recentSeen.clear();
        _counting = true;
      });

  Future<void> _finish() async {
    _counting = false;
    // 브로드캐스트 구독 취소는 기다릴 것이 없다(루트 존의 완료된 Future 라 기다리면
    // 위젯 테스트의 가짜 시계에서 이어지지 않는다).
    unawaited(_sub?.cancel());
    _sub = null;
    await _source.stop();
    widget.onDone(PoseRecording(frames: List.of(_frames), counted: _counter.reps, truth: _counter.reps, at: DateTime.now()));
  }

  @override
  void dispose() {
    _sub?.cancel();
    if (_ready) _source.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hidden = _recentSeen.length >= 10 && _recentSeen.where((s) => !s).length > _recentSeen.length / 2;
    final status = !_counting
        ? '옆모습 전신이 나오게 맞추고 시작을 눌러요'
        : hidden
            ? '다리가 잘 안 보여요. 조금 물러서 주세요'
            : switch (_counter.phase) {
                RepPhase.waiting => '바로 서 주세요',
                RepPhase.standing => '좋아요',
                RepPhase.descending => '내려가는 중',
                RepPhase.bottom => '올라와요',
              };

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text('${widget.lifter.displayName} 스쿼트')),
      body: _error != null
          ? Padding(
              padding: const EdgeInsets.all(Gap.xl),
              child: Text(_error!, style: AppText.body.copyWith(color: Colors.white)),
            )
          : Stack(
              fit: StackFit.expand,
              children: [
                _source.preview(),
                const IgnorePointer(child: CustomPaint(painter: _GuidePainter())),
                Positioned(
                  left: 0,
                  right: 0,
                  top: Gap.xl,
                  child: Column(children: [
                    Text('${_counter.reps}',
                        key: const Key('rep-count'),
                        style: AppText.display.copyWith(color: Colors.white, fontSize: 96)),
                    Text(status, style: AppText.body.copyWith(color: Colors.white)),
                  ]),
                ),
                Positioned(
                  left: Gap.xl,
                  right: Gap.xl,
                  bottom: Gap.xl,
                  child: SizedBox(
                    height: 56,
                    child: FilledButton(
                      onPressed: !_ready ? null : (_counting ? _finish : _begin),
                      style: FilledButton.styleFrom(
                          backgroundColor: _counting ? AppColors.coral : AppColors.teal),
                      child: Text(_counting ? '끝' : '시작',
                          style: AppText.section.copyWith(color: Colors.white)),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

/// 사람이 들어올 자리 안내(세로 직사각형 테두리).
class _GuidePainter extends CustomPainter {
  const _GuidePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width * 0.55, h = size.height * 0.62;
    final r = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.56), width: w, height: h);
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, const Radius.circular(24)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white54,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Result extends ConsumerStatefulWidget {
  const _Result({required this.lifter, required this.recording});

  final Member lifter;
  final PoseRecording recording;

  @override
  ConsumerState<_Result> createState() => _ResultState();
}

class _ResultState extends ConsumerState<_Result> {
  late int _reps = widget.recording.counted;
  Variant _variant = Variant.barbell;
  bool _busy = false;

  bool get _self => widget.lifter.uid.isEmpty;

  /// 고친 횟수를 정답으로 남긴다(하네스 재료). 실패해도 보내기는 계속한다.
  Future<void> _saveRecording() async {
    final r = widget.recording;
    try {
      await ref.read(recordingStoreProvider)
          .save(PoseRecording(frames: r.frames, counted: r.counted, truth: _reps, at: r.at));
    } catch (_) {}
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    // 녹화 파일은 하네스 재료라 보내기를 막지 않는다.
    unawaited(_saveRecording());
    if (_self) {
      context.pushReplacement('/spots/confirm',
          extra: SpotDraft(reps: _reps, at: widget.recording.at, variant: _variant));
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(spotRepositoryProvider).send(
            lifterId: widget.lifter.uid,
            exerciseId: 'squat',
            variant: _variant,
            reps: _reps,
          );
      messenger.showSnackBar(
          SnackBar(content: Text('${widget.lifter.displayName}님에게 보냈어요. 24시간 안에 확인하면 기록돼요.')));
      if (mounted) Navigator.pop(context);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('보내지 못했어요: $e')));
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final counted = widget.recording.counted;
    return Scaffold(
      appBar: AppBar(title: const Text('스쿼트 결과')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          Text(widget.lifter.displayName, style: AppText.title),
          const SizedBox(height: Gap.xs),
          Text('앱이 센 횟수 $counted회. 다르면 고쳐 주세요.', style: AppText.caption),
          const SizedBox(height: Gap.lg),
          Panel(
            child: Row(children: [
              const Expanded(child: Text('횟수', style: AppText.body)),
              IconButton.outlined(
                  onPressed: () => setState(() => _reps = (_reps - 1).clamp(0, 100)),
                  icon: const Icon(Icons.remove)),
              SizedBox(width: 80, child: Text('$_reps회', style: AppText.title, textAlign: TextAlign.center)),
              IconButton.outlined(
                  onPressed: () => setState(() => _reps = (_reps + 1).clamp(0, 100)),
                  icon: const Icon(Icons.add)),
            ]),
          ),
          const SizedBox(height: Gap.md),
          Wrap(spacing: Gap.sm, children: [
            for (final v in exerciseById('squat')!.variants)
              ChoiceChip(label: Text(v.label), selected: v == _variant, onSelected: (_) => setState(() => _variant = v)),
          ]),
          const SizedBox(height: Gap.lg),
          SizedBox(
            height: 56,
            child: FilledButton(
              onPressed: _busy || _reps == 0 ? null : _send,
              child: Text(_self ? '무게 넣고 저장' : '${widget.lifter.displayName}님에게 보내기',
                  style: AppText.section.copyWith(color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }
}
