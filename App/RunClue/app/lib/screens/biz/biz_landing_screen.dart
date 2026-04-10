import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../config/theme.dart';
import '../../widgets/common/haptic_button.dart';

/// Screen 07 — 사장님 랜딩 (BizLanding)
/// B2B 사장님 설득 + 무료 온보딩 진입
class BizLandingScreen extends StatelessWidget {
  const BizLandingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      appBar: AppBar(
        backgroundColor: AppColors.bgBase,
        elevation: 0,
        title: Row(
          children: [
            Text('RUNCLUE',
                style: GoogleFonts.blackHanSans(
                    fontSize: 18, color: AppColors.textPrimary)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: AppColors.brandOrange.withValues(alpha: 0.15),
                border: Border.all(
                    color: AppColors.brandOrange.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.store, size: 12, color: AppColors.brandOrange),
                  const SizedBox(width: 4),
                  Text(
                    '사장님 모드',
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.brandOrange,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.screenH),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.xl),

            // Hero headline
            RichText(
              text: TextSpan(
                style: GoogleFonts.blackHanSans(fontSize: 38, height: 1.1),
                children: [
                  const TextSpan(
                      text: '광고비 ',
                      style: TextStyle(color: AppColors.textPrimary)),
                  TextSpan(
                      text: '없이\n',
                      style: TextStyle(color: AppColors.brandYellow)),
                  const TextSpan(
                      text: '손님이 직접\n찾아오게 하는 법',
                      style: TextStyle(color: AppColors.textPrimary)),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // 3 impact metrics
            Row(
              children: const [
                _ImpactMetric(value: '19,120', label: '활동 탐험가', suffix: '명'),
                _ImpactMetric(value: '36', label: '재방문율', suffix: '%'),
                _ImpactMetric(value: '623', label: '등록 사장님', suffix: '곳'),
              ],
            ),
            const SizedBox(height: AppSpacing.xxl),

            // 3-step onboarding timeline
            Text('시작은 5분이면 충분해요',
                style: AppTextStyles.headingLg.copyWith(color: AppColors.textPrimary)),
            const SizedBox(height: AppSpacing.lg),
            const _TimelineStep(
              number: '1',
              icon: Icons.edit,
              title: '미션 등록',
              description: '미션 내용과 상금을 설정하세요 (5분)',
              isLast: false,
            ),
            const _TimelineStep(
              number: '2',
              icon: Icons.directions_walk,
              title: '탐험가 방문',
              description: '탐험가들이 미션 완료를 위해 방문합니다',
              isLast: false,
            ),
            const _TimelineStep(
              number: '3',
              icon: Icons.account_balance_wallet,
              title: '수익 확인',
              description: '대시보드에서 방문 효과를 실시간 확인',
              isLast: true,
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Testimonials
            Text('믿지 않지만 실화예요',
                style: AppTextStyles.headingLg.copyWith(color: AppColors.textPrimary)),
            const SizedBox(height: AppSpacing.lg),
            SizedBox(
              height: 160,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: const [
                  _TestimonialCard(
                    storeName: '홍대 카페 루나',
                    review: '"주말 방문객이 눈에 띄게 늘었어요. 광고비 제로인데!"',
                    metric: '방문객 +280%',
                  ),
                  SizedBox(width: AppSpacing.md),
                  _TestimonialCard(
                    storeName: '성수 브런치',
                    review: '"SNS 입소문보다 효과가 좋더라고요."',
                    metric: '매출 +45%',
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),

            // Dual CTA
            GradientButton(
              text: '무료로 미션 올리기',
              icon: Icons.add_circle_outline,
              onTap: () => context.push('/create'),
            ),
            const SizedBox(height: AppSpacing.md),
            GradientButton(
              text: '데모 보기',
              style: GradientButtonStyle.ghost,
              onTap: () => context.push('/why-runclue'),
            ),
            const SizedBox(height: AppSpacing.sm),
            Center(
              child: Text(
                '신용카드 불필요 · 즉시 시작',
                style: AppTextStyles.bodySmall.copyWith(color: AppColors.textMuted),
              ),
            ),
            const SizedBox(height: AppSpacing.xxl),
          ],
        ),
      ),
    );
  }
}

class _ImpactMetric extends StatelessWidget {
  final String value;
  final String label;
  final String suffix;
  const _ImpactMetric(
      {required this.value, required this.label, this.suffix = ''});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        margin: const EdgeInsets.symmetric(horizontal: 4),
        decoration: BoxDecoration(
          color: AppColors.bgSurface,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(color: AppColors.borderDefault),
        ),
        child: Column(
          children: [
            RichText(
              text: TextSpan(
                children: [
                  TextSpan(
                    text: value,
                    style: AppTextStyles.headingMd.copyWith(
                      color: AppColors.brandYellow,
                      fontWeight: FontWeight.w900,
                      fontSize: 22,
                    ),
                  ),
                  TextSpan(
                    text: suffix,
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.brandYellow,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 2),
            Text(label,
                style: AppTextStyles.caption.copyWith(color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }
}

class _TimelineStep extends StatelessWidget {
  final String number;
  final IconData icon;
  final String title;
  final String description;
  final bool isLast;

  const _TimelineStep({
    required this.number,
    required this.icon,
    required this.title,
    required this.description,
    this.isLast = false,
  });

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(
                  color: AppColors.brandYellow,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    number,
                    style: AppTextStyles.caption.copyWith(
                      color: Colors.black,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    color: const Color(0x1AFFFFFF),
                  ),
                ),
            ],
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.xl),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(icon, size: 20, color: AppColors.brandGreen),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        title,
                        style: AppTextStyles.bodyLarge.copyWith(
                          color: AppColors.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: AppTextStyles.bodySmall.copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TestimonialCard extends StatelessWidget {
  final String storeName;
  final String review;
  final String metric;
  const _TestimonialCard({
    required this.storeName,
    required this.review,
    required this.metric,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 260,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Stars
          Row(
            children: List.generate(
              5,
              (_) => const Icon(Icons.star, size: 14, color: AppColors.brandYellow),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            storeName,
            style: AppTextStyles.bodyMedium.copyWith(
              color: AppColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Expanded(
            child: Text(
              review,
              style: AppTextStyles.bodySmall.copyWith(
                color: AppColors.textSecondary,
                fontStyle: FontStyle.italic,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            metric,
            style: AppTextStyles.label.copyWith(
              color: AppColors.brandGreen,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
