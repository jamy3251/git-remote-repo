import '../../config/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../providers/auth_provider.dart';
import '../../providers/clue_provider.dart';
import '../../providers/participation_provider.dart';
import '../../widgets/celebration/celebration_overlay.dart';
import '../../widgets/common/loading_widget.dart';
import '../../widgets/common/error_widget.dart' as app;

class ClueResultScreen extends ConsumerStatefulWidget {
  final String clueId;

  const ClueResultScreen({
    super.key,
    required this.clueId,
  });

  @override
  ConsumerState<ClueResultScreen> createState() => _ClueResultScreenState();
}

class _ClueResultScreenState extends ConsumerState<ClueResultScreen> {
  @override
  void initState() {
    super.initState();
    // Trigger celebration on screen entry
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        HapticFeedback.heavyImpact();
        CelebrationOverlay.show(context);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final participationAsync =
        ref.watch(currentParticipationProvider(widget.clueId));
    final clueAsync = ref.watch(clueDetailProvider(widget.clueId));

    return Scaffold(
      body: SafeArea(
        child: participationAsync.when(
          loading: () => const LoadingWidget(),
          error: (e, _) => app.AppErrorWidget(
            message: '결과를 불러올 수 없습니다',
            onRetry: () {
              ref.invalidate(currentParticipationProvider(widget.clueId));
            },
          ),
          data: (participation) {
            final clue = clueAsync.valueOrNull;
            final totalPoints =
                participation?['total_points_earned'] ?? 0;
            final rank = participation?['rank'];
            final completedAt = participation?['completed_at'];
            final startedAt = participation?['started_at'] ??
                participation?['created_at'];

            String elapsedStr = '--:--';
            if (completedAt != null && startedAt != null) {
              try {
                final start = DateTime.parse(startedAt);
                final end = DateTime.parse(completedAt);
                final diff = end.difference(start);
                final m = diff.inMinutes;
                final s = diff.inSeconds % 60;
                elapsedStr =
                    '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
              } catch (_) {}
            }

            final steps = (clue?['steps'] as List<dynamic>?)
                    ?.cast<Map<String, dynamic>>() ??
                [];
            final completedStepIndex =
                participation?['current_step_index'] ?? steps.length;

            return SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  const SizedBox(height: 20),

                  // Celebration
                  Container(
                    height: 120,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          Colors.amber[100]!,
                          Colors.orange[100]!,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.celebration,
                              size: 48, color: Colors.orange),
                          const SizedBox(height: 8),
                          Text(
                            participation?['status'] == 'completed'
                                ? '축하합니다!'
                                : '클루 결과',
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.bold,
                              color: Colors.orange,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Rank
                  if (rank != null)
                    Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            Colors.amber[400]!,
                            Colors.orange[400]!,
                          ],
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.amber.withOpacity(0.3),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              '#$rank',
                              style: const TextStyle(
                                fontSize: 36,
                                fontWeight: FontWeight.w900,
                                color: Colors.white,
                              ),
                            ),
                            const Text(
                              '등',
                              style: TextStyle(
                                fontSize: 14,
                                color: Colors.white,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 32),

                  // Stats
                  Row(
                    children: [
                      Expanded(
                        child: _StatCard(
                          icon: Icons.star,
                          label: '총 포인트',
                          value: '$totalPoints',
                          color: Colors.amber,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _StatCard(
                          icon: Icons.timer,
                          label: '소요 시간',
                          value: elapsedStr,
                          color: Colors.blue,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),

                  // Step Results
                  if (steps.isNotEmpty) ...[
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '스텝별 결과',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    ...steps.asMap().entries.map((entry) {
                      final index = entry.key;
                      final step = entry.value;
                      final passed = index < completedStepIndex;
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color:
                              passed ? Colors.green[50] : Colors.red[50],
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: passed
                                ? Colors.green[200]!
                                : Colors.red[200]!,
                          ),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              passed
                                  ? Icons.check_circle
                                  : Icons.cancel,
                              color:
                                  passed ? Colors.green : Colors.red,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Step ${index + 1}: ${step['title'] ?? ''}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w500,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                            Text(
                              passed ? '통과' : '미완료',
                              style: TextStyle(
                                color: passed
                                    ? Colors.green[700]
                                    : Colors.red[700],
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                    const SizedBox(height: 24),
                  ],

                  // Reward
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.purple[50]!, Colors.blue[50]!],
                      ),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: Colors.purple[100]!),
                    ),
                    child: Column(
                      children: [
                        const Icon(Icons.emoji_events,
                            size: 40, color: Colors.purple),
                        const SizedBox(height: 8),
                        const Text(
                          '획득한 보상',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          totalPoints > 0
                              ? '$totalPoints 포인트'
                              : '클루 완료!',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Colors.purple[700],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Actions
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        _showLeaderboard(context);
                      },
                      icon: const Icon(Icons.leaderboard),
                      label: const Text(
                        '랭킹 보기',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      style: ElevatedButton.styleFrom(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        final title = clue?['title'] ?? 'RunClue';
                        Share.share(
                          '[$title] 클루를 완료했어요! #RunClue',
                        );
                      },
                      icon: const Icon(Icons.share),
                      label: const Text(
                        '공유하기',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      style: OutlinedButton.styleFrom(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: TextButton(
                      onPressed: () => context.go('/explore'),
                      child: const Text(
                        '홈으로',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  void _showLeaderboard(BuildContext context) {
    final leaderboardAsync = ref.read(leaderboardProvider(widget.clueId));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Consumer(
          builder: (ctx, ref, _) {
            final lbAsync = ref.watch(leaderboardProvider(widget.clueId));
            return DraggableScrollableSheet(
              initialChildSize: 0.6,
              maxChildSize: 0.9,
              minChildSize: 0.3,
              expand: false,
              builder: (ctx, scrollController) {
                return Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.grey[300],
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        '랭킹',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 16),
                      Expanded(
                        child: lbAsync.when(
                          loading: () => const LoadingWidget(),
                          error: (_, __) =>
                              const Center(child: Text('랭킹을 불러올 수 없습니다')),
                          data: (entries) {
                            if (entries.isEmpty) {
                              return const Center(
                                  child: Text('아직 완료한 참여자가 없습니다'));
                            }
                            return ListView.builder(
                              controller: scrollController,
                              itemCount: entries.length,
                              itemBuilder: (ctx, index) {
                                final entry = entries[index];
                                final profile = entry['profiles']
                                    as Map<String, dynamic>?;
                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: index == 0
                                        ? Colors.amber
                                        : index == 1
                                            ? AppColors.textMuted
                                            : index == 2
                                                ? Colors.brown[300]
                                                : AppColors.bgSurface,
                                    child: Text(
                                      '${index + 1}',
                                      style: TextStyle(
                                        color: index < 3
                                            ? Colors.white
                                            : Colors.black,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  title: Text(
                                    profile?['nickname'] ?? '유저',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600),
                                  ),
                                  trailing: Text(
                                    '${entry['total_points_earned'] ?? 0}점',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w600),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}
