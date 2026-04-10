import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../config/theme.dart';
import '../../providers/clue_provider.dart';
import '../../providers/profile_provider.dart';
import '../../services/platform_stats_service.dart';
import '../../widgets/cards/persona_card.dart';
import '../../widgets/clue_card.dart';
import '../../widgets/common/category_filter_tabs.dart';
import '../../widgets/common/earnings_notification_banner.dart';
import '../../widgets/common/gradient_scaffold.dart';
import '../../widgets/survey_banner.dart';

/// Home / 플랫폼 대시보드 — PDF spec Page 5 (Home.tsx)
///
/// 구조:
///   A) 헤더: RUNCLUE 로고 + 검색 + 알림
///   B) 플랫폼 스탯 바: 참여자수 | 누적수익 | 활성미션
///   C) 역할 탭: 탐험가 | 크리에이터 | 사장님
///   D) LIVE 히어로 카드
///   E) 미션 카드 리스트
///   F) FAB: +클루 만들기
class ExploreScreen extends ConsumerStatefulWidget {
  const ExploreScreen({super.key});

  @override
  ConsumerState<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends ConsumerState<ExploreScreen> {
  int _selectedRoleTab = 0;
  int _selectedCategory = 0;
  final _roles = ['탐험가', '크리에이터', '사장님'];
  final _roleIcons = [Icons.explore, Icons.edit, Icons.store];

  @override
  Widget build(BuildContext context) {
    final trendingAsync = ref.watch(trendingCluesProvider);

    return GradientScaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // 수익 알림 배너 — 로그인 사용자의 프로필명 표시, 비로그인 시 숨김
            SliverToBoxAdapter(
              child: ref.watch(myProfileProvider).when(
                data: (profile) {
                  if (profile == null) return const SizedBox.shrink();
                  final name = profile['nickname'] ?? profile['display_name'] ?? '탐험가';
                  return EarningsNotificationBanner(
                    userName: name,
                    amount: '₩18,000',
                  );
                },
                loading: () => const SizedBox.shrink(),
                error: (_, __) => const SizedBox.shrink(),
              ),
            ),

            // A) 헤더
            SliverToBoxAdapter(child: _buildHeader()),

            // B) 플랫폼 스탯 바
            SliverToBoxAdapter(child: _buildStatBar()),

            // C) 역할 탭
            SliverToBoxAdapter(child: _buildRoleTabs()),

            // 카테고리 필터 탭
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: CategoryFilterTabs(
                  tabs: const [
                    FilterTab(label: '전체', icon: Icons.local_fire_department),
                    FilterTab(label: '실시간', icon: Icons.radio),
                    FilterTab(label: '탐험', icon: Icons.explore),
                    FilterTab(label: '퀴즈', icon: Icons.help_outline),
                    FilterTab(label: '카페·맛집', icon: Icons.coffee),
                    FilterTab(label: '근처', icon: Icons.location_on),
                  ],
                  selectedIndex: _selectedCategory,
                  onSelected: (i) => setState(() => _selectedCategory = i),
                ),
              ),
            ),

            // 설문/공모전 배너
            SliverToBoxAdapter(
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  const SurveyBanner(),
                  ContestBanner(
                    title: '첫 번째 클루 공모전',
                    subtitle: '가장 창의적인 클루를 만들어보세요!',
                    prize: '₩500,000',
                  ),
                ],
              ),
            ),

            // D) LIVE 히어로 카드
            SliverToBoxAdapter(child: _buildLiveHero()),

            // 페르소나 카드 섹션
            SliverToBoxAdapter(
              child: _SectionHeader(title: '이런 분들이 쓰고 있어요', onSeeAll: () {}),
            ),
            // 마케팅 페르소나 — 고정 콘텐츠 (의도적)
            SliverToBoxAdapter(
              child: PersonaCardList(
                cards: [
                  PersonaCard(
                    name: '준서 (19)',
                    role: '대학생 탐험가',
                    monthlyEarnings: '₩320,000/월',
                    empathyText: '수업 끝나고 미션 돌면서 용돈 벌어요',
                    accentColor: AppColors.brandYellow,
                    icon: Icons.school,
                  ),
                  PersonaCard(
                    name: '수빈 (28)',
                    role: '직장인 크리에이터',
                    monthlyEarnings: '₩180,000/월',
                    empathyText: '주말에 동네 미션 만들면서 부수입',
                    accentColor: AppColors.brandBlue,
                    icon: Icons.work,
                  ),
                  PersonaCard(
                    name: '영호 (45)',
                    role: '카페 사장님',
                    monthlyEarnings: '광고비 ₩0',
                    empathyText: '미션 하나 올렸더니 주말 매출 40% 상승',
                    accentColor: AppColors.brandOrange,
                    icon: Icons.store,
                  ),
                ],
              ),
            ),

            // 섹션: 지금 인기 미션
            SliverToBoxAdapter(
              child: _SectionHeader(title: '지금 인기 미션', onSeeAll: () {}),
            ),

            // E) 미션 카드 리스트
            trendingAsync.when(
              data: (clues) {
                if (clues.isEmpty) {
                  return SliverToBoxAdapter(
                    child: _EmptyState(
                      icon: Icons.explore_off,
                      message: '아직 미션이 없어요',
                      sub: '첫 번째 미션을 만들어보세요!',
                    ),
                  );
                }
                return SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final clue = clues[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                        child: ClueCard(
                          title: clue['title'] ?? '제목 없음',
                          creatorName: clue['creator_profile']?['nickname'] ?? '크리에이터',
                          category: clue['category'] ?? 'adventure',
                          locationText: clue['address'] ?? '위치 미설정',
                          participantCount: clue['current_participants'] ?? 0,
                          thumbnailUrl: clue['thumbnail_url'],
                          rewardText: clue['reward_value'] != null ? '₩${clue['reward_value']}' : null,
                          onTap: () => context.push('/clue/${clue['id']}'),
                        ),
                      );
                    },
                    childCount: clues.length,
                  ),
                );
              },
              loading: () => const SliverToBoxAdapter(
                child: Center(
                  child: Padding(
                    padding: EdgeInsets.all(48),
                    child: CircularProgressIndicator(color: AppColors.brandYellow),
                  ),
                ),
              ),
              error: (e, _) => SliverToBoxAdapter(
                child: _EmptyState(
                  icon: Icons.wifi_off,
                  message: '미션을 불러올 수 없습니다',
                  sub: '네트워크 연결을 확인해주세요',
                ),
              ),
            ),

            // 하단 여백
            const SliverToBoxAdapter(child: SizedBox(height: 100)),
          ],
        ),
      ),
      // F) FAB
      floatingActionButton: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: const LinearGradient(
            colors: [AppColors.brandYellow, AppColors.brandYellowDeep],
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.brandYellow.withValues(alpha: 0.4),
              blurRadius: 20,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: FloatingActionButton(
          onPressed: () => context.go('/create'),
          backgroundColor: Colors.transparent,
          elevation: 0,
          child: const Icon(Icons.add, color: Colors.black, size: 28),
        ),
      ),
    );
  }

  // ─── A) 헤더 ───
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.brandYellow,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text('R', style: GoogleFonts.blackHanSans(fontSize: 16, color: Colors.black)),
          ),
          const SizedBox(width: 8),
          Text('RUNCLUE', style: GoogleFonts.blackHanSans(
            fontSize: 14, color: AppColors.textPrimary, letterSpacing: 2,
          )),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.search, color: AppColors.textSecondary, size: 22),
            onPressed: () => context.push('/search'),
          ),
          Stack(
            children: [
              IconButton(
                icon: const Icon(Icons.notifications_outlined, color: AppColors.textSecondary, size: 22),
                onPressed: () => context.push('/notifications'),
              ),
              Positioned(
                right: 8, top: 8,
                child: Container(
                  width: 8, height: 8,
                  decoration: const BoxDecoration(
                    color: AppColors.brandRed,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ─── B) 플랫폼 스탯 바 ───
  Widget _buildStatBar() {
    final statsAsync = ref.watch(platformStatsProvider);
    // Remix D: 풀와이드 바, 여백/라운드/보더 없음
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.03),
        border: Border.symmetric(
          horizontal: BorderSide(color: Colors.white.withValues(alpha: 0.04)),
        ),
      ),
      child: statsAsync.when(
        data: (stats) => Row(
          children: [
            _StatItem(value: _fmtNum(stats.totalParticipants), label: '참여자', valueColor: AppColors.brandYellow),
            _divider(),
            _StatItem(value: _fmtWon(stats.cumulativeEarnings), label: '누적수익', valueColor: AppColors.brandGreen),
            _divider(),
            _StatItem(value: _fmtNum(stats.activeMissions), label: '활성미션', valueColor: AppColors.brandBlue),
          ],
        ),
        loading: () => Row(
          children: [
            _StatItem(value: '...', label: '참여자', valueColor: AppColors.brandYellow),
            _divider(),
            _StatItem(value: '...', label: '누적수익', valueColor: AppColors.brandGreen),
            _divider(),
            _StatItem(value: '...', label: '활성미션', valueColor: AppColors.brandBlue),
          ],
        ),
        error: (_, __) => Row(
          children: [
            _StatItem(value: '3,241', label: '참여자', valueColor: AppColors.brandYellow),
            _divider(),
            _StatItem(value: '₩12.5M', label: '누적수익', valueColor: AppColors.brandGreen),
            _divider(),
            _StatItem(value: '18,340', label: '활성미션', valueColor: AppColors.brandBlue),
          ],
        ),
      ),
    );
  }

  String _fmtNum(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return n.toString();
  }

  String _fmtWon(int won) {
    if (won >= 1000000) return '₩${(won / 1000000).toStringAsFixed(1)}M';
    if (won >= 1000) return '₩${(won / 1000).toStringAsFixed(1)}K';
    return '₩$won';
  }

  Widget _divider() => Container(
    width: 1, height: 28,
    color: AppColors.borderDefault,
  );

  // ─── C) 역할 탭 ───
  Widget _buildRoleTabs() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: List.generate(3, (i) {
          final isActive = _selectedRoleTab == i;
          return Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedRoleTab = i),
              child: Container(
                margin: EdgeInsets.only(right: i < 2 ? 8 : 0),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: isActive
                      ? AppColors.brandYellow.withValues(alpha: 0.08)
                      : Colors.white.withValues(alpha: 0.04),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: isActive
                        ? AppColors.brandYellow
                        : AppColors.borderDefault,
                    width: isActive ? 1.5 : 1,
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      _roleIcons[i], size: 16,
                      color: isActive ? AppColors.brandYellow : AppColors.textMuted,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _roles[i],
                      style: GoogleFonts.notoSansKr(
                        fontSize: 12,
                        fontWeight: isActive ? FontWeight.w700 : FontWeight.w400,
                        color: isActive ? AppColors.brandYellow : AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  // ─── D) LIVE 히어로 카드 ───
  Widget _buildLiveHero() {
    final trendingAsync = ref.watch(trendingCluesProvider);
    return trendingAsync.when(
      data: (clues) {
        if (clues.isEmpty) return _buildEmptyHero();
        final clue = clues.first;
        final title = clue['title'] ?? '제목 없음';
        final description = clue['description'] ?? '';
        final reward = clue['reward_value'];
        final rewardText = reward != null ? '₩${_fmtReward(reward)}' : '보상 미정';
        final participants = clue['current_participants'] ?? 0;
        final clueId = clue['id'] as String?;
        return _buildHeroCard(
          title: title,
          description: description,
          rewardText: rewardText,
          participantText: '$participants명 참여 중',
          onJoin: clueId != null ? () => context.push('/clue/$clueId') : null,
        );
      },
      loading: () => _buildHeroCard(
        title: '로딩 중...',
        description: '',
        rewardText: '...',
        participantText: '...',
        onJoin: null,
      ),
      error: (_, __) => _buildEmptyHero(),
    );
  }

  String _fmtReward(dynamic value) {
    final n = value is int ? value : int.tryParse(value.toString()) ?? 0;
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(0)},000,000';
    if (n >= 1000) {
      final thousands = n ~/ 1000;
      final remainder = n % 1000;
      if (remainder == 0) return '${thousands},000';
      return '${thousands},${remainder.toString().padLeft(3, '0')}';
    }
    return n.toString();
  }

  Widget _buildEmptyHero() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      height: 200,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [AppColors.bgSurface, AppColors.bgHero],
        ),
        border: Border.all(color: AppColors.borderDefault),
      ),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.explore, size: 40, color: AppColors.brandYellow.withValues(alpha: 0.6)),
            const SizedBox(height: 12),
            Text('첫 미션을 만들어보세요!', style: GoogleFonts.blackHanSans(
              fontSize: 18, color: AppColors.textPrimary,
            )),
            const SizedBox(height: 4),
            Text('클루를 만들고 탐험가들을 초대하세요', style: GoogleFonts.notoSansKr(
              fontSize: 13, color: AppColors.textSecondary,
            )),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () => context.go('/create'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brandYellow,
                foregroundColor: Colors.black,
                minimumSize: const Size(0, 36),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              child: Text('만들기 →', style: GoogleFonts.notoSansKr(
                fontSize: 13, fontWeight: FontWeight.w900,
              )),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeroCard({
    required String title,
    required String description,
    required String rewardText,
    required String participantText,
    VoidCallback? onJoin,
  }) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      height: 200,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.bgSurface,
            AppColors.bgHero,
          ],
        ),
        border: Border.all(color: AppColors.borderDefault),
      ),
      child: Stack(
        children: [
          // Remix D: 퍼플 글로우 (우상단)
          Positioned(
            right: -20, top: -20,
            child: Container(
              width: 140, height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppColors.brandPurple.withValues(alpha: 0.12),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
          // Remix D: 노란 글로우 (좌하단)
          Positioned(
            left: -30, bottom: -30,
            child: Container(
              width: 100, height: 100,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    AppColors.brandYellow.withValues(alpha: 0.08),
                    Colors.transparent,
                  ],
                ),
              ),
            ),
          ),
          // LIVE 배지
          Positioned(
            top: 16, left: 16,
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.brandRed.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(width: 6, height: 6,
                        decoration: const BoxDecoration(color: AppColors.brandRed, shape: BoxShape.circle)),
                      const SizedBox(width: 4),
                      Text('LIVE', style: GoogleFonts.notoSansKr(
                        fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.brandRed,
                      )),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 참여자 수
          Positioned(
            top: 16, right: 16,
            child: Row(
              children: [
                const Icon(Icons.people, size: 14, color: AppColors.textMuted),
                const SizedBox(width: 4),
                Text(participantText, style: GoogleFonts.notoSansKr(
                  fontSize: 11, color: AppColors.textMuted,
                )),
              ],
            ),
          ),
          // 하단: 미션 제목 + 상금 + 참여 버튼
          Positioned(
            bottom: 16, left: 16, right: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: GoogleFonts.blackHanSans(
                  fontSize: 20, color: AppColors.textPrimary,
                )),
                if (description.isNotEmpty)
                  Text(description, style: GoogleFonts.notoSansKr(
                    fontSize: 13, color: AppColors.textSecondary,
                  ), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(rewardText, style: GoogleFonts.blackHanSans(
                      fontSize: 22, color: AppColors.brandYellow,
                    )),
                    const Spacer(),
                    ElevatedButton(
                      onPressed: onJoin,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.brandYellow,
                        foregroundColor: Colors.black,
                        minimumSize: const Size(0, 36),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: Text('참여 →', style: GoogleFonts.notoSansKr(
                        fontSize: 13, fontWeight: FontWeight.w900,
                      )),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── 섹션 헤더 ───
class _SectionHeader extends StatelessWidget {
  final String title;
  final VoidCallback? onSeeAll;
  const _SectionHeader({required this.title, this.onSeeAll});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
      child: Row(
        children: [
          Text(title, style: GoogleFonts.blackHanSans(
            fontSize: 18, color: AppColors.textPrimary,
          )),
          const Spacer(),
          if (onSeeAll != null)
            TextButton(
              onPressed: onSeeAll,
              child: Text('전체보기', style: GoogleFonts.notoSansKr(
                fontSize: 12, color: AppColors.brandYellow,
              )),
            ),
        ],
      ),
    );
  }
}

// ─── 스탯 아이템 ───
class _StatItem extends StatelessWidget {
  final String value;
  final String label;
  final Color valueColor;
  const _StatItem({required this.value, required this.label, this.valueColor = AppColors.brandYellow});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(value, style: GoogleFonts.notoSansKr(
            fontSize: 18, fontWeight: FontWeight.w900, color: valueColor,
            shadows: [Shadow(blurRadius: 10, color: valueColor.withValues(alpha: 0.3))],
          )),
          const SizedBox(height: 2),
          Text(label, style: GoogleFonts.notoSansKr(
            fontSize: 11, color: AppColors.textSecondary,
          )),
        ],
      ),
    );
  }
}

// ─── 빈 상태 ───
class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String message;
  final String sub;
  const _EmptyState({required this.icon, required this.message, required this.sub});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(48),
      child: Column(
        children: [
          Icon(icon, size: 48, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(message, style: GoogleFonts.notoSansKr(
            fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.textSecondary,
          )),
          const SizedBox(height: 4),
          Text(sub, style: GoogleFonts.notoSansKr(
            fontSize: 13, color: AppColors.textMuted,
          )),
        ],
      ),
    );
  }
}
