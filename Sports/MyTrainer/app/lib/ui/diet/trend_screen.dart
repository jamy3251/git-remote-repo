import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../../diet/diet_state.dart';
import '../../diet/tracking.dart';
import '../widgets/panel.dart';
import 'diet_screen.dart';

/// 열량 추적: 기간별 섭취·운동 소모, 체중 추세, 기록으로 잰 유지 열량.
class TrendScreen extends ConsumerStatefulWidget {
  const TrendScreen({super.key});

  @override
  ConsumerState<TrendScreen> createState() => _TrendScreenState();
}

class _TrendScreenState extends ConsumerState<TrendScreen> {
  int _days = 7;

  @override
  Widget build(BuildContext context) {
    final now = ref.read(clockProvider)();
    final meals = ref.watch(mealsProvider).valueOrNull ?? const [];
    final target = ref.watch(dailyTargetProvider);
    final burn = ref.watch(workoutBurnProvider);
    final days = dailyIntake(meals, dayOf(now).subtract(Duration(days: _days - 1)), now);

    return Scaffold(
      appBar: AppBar(title: const Text('열량 추적')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.xl, Gap.md, Gap.xl, Gap.huge),
        children: [
          SegmentedButton<int>(
            segments: const [ButtonSegment(value: 7, label: Text('7일')), ButtonSegment(value: 30, label: Text('30일'))],
            selected: {_days},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => _days = s.first),
          ),
          const SizedBox(height: Gap.md),
          _IntakePanel(days: days, target: target?.target.kcal, burn: burn, today: dayOf(now)),
          const SizedBox(height: Gap.md),
          const _WeightPanel(),
          const SizedBox(height: Gap.md),
          const _TdeePanel(),
        ],
      ),
    );
  }
}

class _IntakePanel extends StatelessWidget {
  const _IntakePanel({required this.days, required this.target, required this.burn, required this.today});

  final List<DayIntake> days;
  final double? target;
  final Map<DateTime, WorkoutBurn> burn;
  final DateTime today;

  @override
  Widget build(BuildContext context) {
    // 오늘은 아직 덜 먹었으니 평균에서 뺀다.
    final past = days.where((d) => d.logged && d.day != today).toList();
    final avg = past.isEmpty ? null : past.fold(0.0, (a, d) => a + d.eaten.kcal) / past.length;
    final burns = [for (final d in days) burn[d.day]].whereType<WorkoutBurn>().toList();
    final burnSum = burns.fold(0.0, (a, b) => a + b.kcal);

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PanelLabel('먹은 열량'),
        Text(avg == null ? '아직 지난 기록이 없어요' : '하루 평균 ${kcal(avg)}', style: AppText.title),
        if (avg != null && target != null)
          Text(
            avg <= target! ? '목표보다 ${kcal(target! - avg)} 적게 먹었어요' : '목표보다 ${kcal(avg - target!)} 더 먹었어요',
            style: AppText.caption,
          ),
        const SizedBox(height: Gap.md),
        SizedBox(
          height: 140,
          width: double.infinity,
          child: CustomPaint(painter: _BarsPainter(days: days, target: target, burn: burn, today: today)),
        ),
        const SizedBox(height: Gap.xs),
        Row(children: [
          Text(DateFormat('M/d').format(days.first.day), style: AppText.micro),
          const Spacer(),
          const _Key(color: AppColors.teal, text: '먹음'),
          const SizedBox(width: Gap.md),
          const _Key(color: AppColors.amber, text: '운동 소모'),
          if (target != null) ...[const SizedBox(width: Gap.md), const _Key(color: AppColors.inkFaint, text: '목표')],
          const Spacer(),
          Text('오늘', style: AppText.micro),
        ]),
        const SizedBox(height: Gap.md),
        Text('식단 남긴 날 ${days.where((d) => d.logged).length}/${days.length}일', style: AppText.label),
        Text(
          burns.isEmpty
              ? '이 기간 운동 기록이 없어요'
              : '운동 ${burns.length}일 · 약 ${kcal(burnSum)} 소모 (하루 평균 ${kcal(burnSum / days.length)})',
          style: AppText.label,
        ),
        const SizedBox(height: Gap.xs),
        Text(
          '운동 소모는 세트 기록 시각으로 잡은 운동 시간 × 체중 × 웨이트 운동 강도(MET 5)로 짐작한 값이에요. '
          '평소 활동량에 이미 들어 있어서 목표에 따로 더하지 않아요.',
          style: AppText.caption,
        ),
      ]),
    );
  }
}

class _Key extends StatelessWidget {
  const _Key({required this.color, required this.text});
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 4),
        Text(text, style: AppText.micro),
      ]);
}

class _BarsPainter extends CustomPainter {
  _BarsPainter({required this.days, required this.target, required this.burn, required this.today});

  final List<DayIntake> days;
  final double? target;
  final Map<DateTime, WorkoutBurn> burn;
  final DateTime today;

  @override
  void paint(Canvas canvas, Size size) {
    final top = [
      for (final d in days) d.eaten.kcal,
      for (final d in days) burn[d.day]?.kcal ?? 0,
      target ?? 0,
    ].reduce(math.max);
    final max = top <= 0 ? 1000.0 : top * 1.15;
    final slot = size.width / days.length;
    final w = math.max(2.0, slot * 0.6);
    double y(double v) => size.height - v / max * size.height;

    final eat = Paint()..color = AppColors.teal;
    final eatToday = Paint()..color = AppColors.teal.withValues(alpha: 0.45);
    final fire = Paint()
      ..color = AppColors.amber
      ..strokeWidth = math.max(2.0, w * 0.35)
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i < days.length; i++) {
      final d = days[i];
      final x = slot * i + (slot - w) / 2;
      if (d.logged) {
        canvas.drawRRect(
          RRect.fromRectAndCorners(Rect.fromLTRB(x, y(d.eaten.kcal), x + w, size.height),
              topLeft: const Radius.circular(2), topRight: const Radius.circular(2)),
          d.day == today ? eatToday : eat,
        );
      } else {
        canvas.drawLine(Offset(x, size.height - 1), Offset(x + w, size.height - 1), Paint()..color = AppColors.lineSoft);
      }
      final b = burn[d.day];
      if (b != null && b.kcal > 0) {
        final cx = x + w / 2;
        canvas.drawLine(Offset(cx, size.height), Offset(cx, y(b.kcal)), fire);
      }
    }
    if (target != null) {
      final ty = y(target!);
      final line = Paint()
        ..color = AppColors.inkFaint
        ..strokeWidth = 1;
      for (var x = 0.0; x < size.width; x += 8) {
        canvas.drawLine(Offset(x, ty), Offset(math.min(x + 4, size.width), ty), line);
      }
    }
  }

  @override
  bool shouldRepaint(_BarsPainter old) =>
      old.days != days || old.target != target || old.burn != burn || old.today != today;
}

class _WeightPanel extends ConsumerStatefulWidget {
  const _WeightPanel();

  @override
  ConsumerState<_WeightPanel> createState() => _WeightPanelState();
}

class _WeightPanelState extends ConsumerState<_WeightPanel> {
  final _kg = TextEditingController();

  @override
  void dispose() {
    _kg.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final v = double.tryParse(_kg.text.trim());
    if (v == null || v < 25 || v > 300) return;
    await ref.read(weightsProvider.notifier).save(v);
    _kg.clear();
    if (mounted) FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final weights = ref.watch(weightsProvider).valueOrNull ?? const <WeightEntry>[];
    final today = dayOf(ref.read(clockProvider)());
    final trend = weightTrend(weights);
    final todayW = weights.where((w) => w.day == today).firstOrNull;
    final weekAgo = trend.where((p) => !p.day.isAfter(today.subtract(const Duration(days: 7)))).lastOrNull;

    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PanelLabel('체중'),
        if (trend.isEmpty)
          Text('아침에 화장실 다녀온 뒤 재면 가장 고르게 나와요', style: AppText.body)
        else ...[
          Text('추세 ${trend.last.trend.toStringAsFixed(1)}kg', style: AppText.title),
          if (weekAgo != null)
            Text('1주 전보다 ${_signed(trend.last.trend - weekAgo.trend)}kg', style: AppText.caption),
          const SizedBox(height: Gap.md),
          SizedBox(height: 110, width: double.infinity, child: CustomPaint(painter: _WeightPainter(trend))),
          const SizedBox(height: Gap.xs),
          Text('점은 잰 값, 선은 하루하루 흔들림을 걸러 낸 추세예요.', style: AppText.caption),
        ],
        const SizedBox(height: Gap.md),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _kg,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))],
              decoration: InputDecoration(
                labelText: todayW == null ? '오늘 체중' : '오늘 ${todayW.kg.toStringAsFixed(1)}kg · 고치기',
                suffixText: 'kg',
              ),
              onSubmitted: (_) => _save(),
            ),
          ),
          const SizedBox(width: Gap.sm),
          FilledButton(onPressed: _save, child: const Text('저장')),
        ]),
      ]),
    );
  }

  static String _signed(double v) => '${v >= 0 ? '+' : ''}${v.toStringAsFixed(1)}';
}

class _WeightPainter extends CustomPainter {
  _WeightPainter(this.points);

  final List<TrendPoint> points;

  @override
  void paint(Canvas canvas, Size size) {
    final values = [for (final p in points) p.trend, for (final p in points) if (p.measured != null) p.measured!];
    var lo = values.reduce(math.min), hi = values.reduce(math.max);
    if (hi - lo < 1) {
      final mid = (hi + lo) / 2;
      lo = mid - 0.5;
      hi = mid + 0.5;
    }
    final pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
    final first = points.first.day;
    final span = math.max(1, points.last.day.difference(first).inDays);
    double x(DateTime d) => d.difference(first).inDays / span * size.width;
    double y(double v) => size.height - (v - lo) / (hi - lo) * size.height;

    final dot = Paint()..color = AppColors.inkFaint;
    for (final p in points) {
      if (p.measured != null) canvas.drawCircle(Offset(x(p.day), y(p.measured!)), 2.5, dot);
    }
    final path = Path()..moveTo(x(points.first.day), y(points.first.trend));
    for (final p in points.skip(1)) {
      path.lineTo(x(p.day), y(p.trend));
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = AppColors.plum
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(_WeightPainter old) => old.points != points;
}

class _TdeePanel extends ConsumerWidget {
  const _TdeePanel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final m = ref.watch(measuredTdeeProvider);
    final target = ref.watch(dailyTargetProvider);
    if (m == null || target == null) {
      return Panel(
        child: Text('몸 정보를 넣으면 체중·식단 기록으로 실제 유지 열량을 재요.', style: AppText.body),
      );
    }
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PanelLabel('내 실제 유지 열량'),
        Text(
          m.ready ? '${kcal(m.kcal!)} · 목표에 반영 중' : '계산식 ${kcal(target.formulaTdee)} 사용 중',
          style: AppText.title,
        ),
        const SizedBox(height: Gap.sm),
        for (final r in m.reasons) Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(r, style: AppText.body)),
        const SizedBox(height: Gap.sm),
        Text(
          '체중을 꾸준히 재고(주 4번 이상) 식단을 빠짐없이 남기면 2주 뒤부터 계산식 대신 내 몸에 맞는 값으로 목표를 잡아요.',
          style: AppText.caption,
        ),
      ]),
    );
  }
}
