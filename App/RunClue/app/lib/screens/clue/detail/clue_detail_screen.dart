import '../../../config/theme.dart';
import '../../../config/supabase_safe.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../providers/clue_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/participation_provider.dart';
import '../../../services/participation_service.dart';
import '../../../widgets/common/badge_chip.dart';
import '../../../widgets/common/loading_widget.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../../services/deep_link_service.dart';
import '../../../services/report_service.dart';
import '../../../widgets/common/error_widget.dart' as app;
import '../../../widgets/step_type_icon.dart';

class ClueDetailScreen extends ConsumerWidget {
  final String clueId;

  const ClueDetailScreen({
    super.key,
    required this.clueId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clueAsync = ref.watch(clueDetailProvider(clueId));

    return clueAsync.when(
      loading: () => const Scaffold(body: LoadingWidget()),
      error: (e, _) => Scaffold(
        appBar: AppBar(),
        body: app.AppErrorWidget(
          message: '클루를 불러올 수 없습니다',
          onRetry: () => ref.invalidate(clueDetailProvider(clueId)),
        ),
      ),
      data: (clue) {
        if (clue == null) {
          return Scaffold(
            appBar: AppBar(),
            body: const Center(child: Text('클루를 찾을 수 없습니다')),
          );
        }

        final steps =
            (clue['steps'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
                [];
        final title = clue['title'] ?? '';
        final description = clue['description'] ?? '';
        final category = clue['category'] ?? '';
        final status = clue['status'] ?? '';
        final participantCount = clue['participant_count'] ?? 0;
        final maxParticipants = clue['max_participants'];
        final thumbnailUrl = clue['thumbnail_url'] as String?;
        final startsAt = clue['starts_at'] as String?;
        final endsAt = clue['ends_at'] as String?;
        final timeLimitMin = clue['time_limit_minutes'];
        final locationName = clue['location_name'] ?? '';
        final rewardType = clue['reward_type'] ?? '';
        final rewardValue = clue['reward_value'] ?? '';

        final statusLabel = _statusLabel(status);

        return Scaffold(
          body: CustomScrollView(
            slivers: [
              // Hero Image / App Bar
              SliverAppBar(
                expandedHeight: 250,
                pinned: true,
                leading: IconButton(
                  icon: const CircleAvatar(
                    backgroundColor: Colors.black26,
                    child: Icon(Icons.arrow_back, color: Colors.white),
                  ),
                  onPressed: () => context.pop(),
                ),
                actions: [
                  IconButton(
                    icon: const CircleAvatar(
                      backgroundColor: Colors.black26,
                      child:
                          Icon(Icons.share, color: Colors.white, size: 20),
                    ),
                    onPressed: () {
                      DeepLinkService.shareClue(
                        clueId: clueId,
                        clueTitle: clue['title'] ?? '',
                      );
                    },
                  ),
                  PopupMenuButton<String>(
                    icon: const CircleAvatar(
                      backgroundColor: Colors.black26,
                      child: Icon(Icons.more_vert,
                          color: Colors.white, size: 20),
                    ),
                    onSelected: (value) {
                      if (value == 'report') {
                        _showReportDialog(context);
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'report',
                        child: Row(
                          children: [
                            Icon(Icons.flag, color: Colors.red),
                            SizedBox(width: 8),
                            Text('신고하기'),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
                flexibleSpace: FlexibleSpaceBar(
                  background: thumbnailUrl != null
                      ? Image.network(
                          thumbnailUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            color: Colors.grey[300],
                            child: const Center(
                              child: Icon(Icons.image,
                                  size: 64, color: Colors.grey),
                            ),
                          ),
                        )
                      : Container(
                          color: Colors.grey[300],
                          child: const Center(
                            child: Icon(Icons.image,
                                size: 64, color: Colors.grey),
                          ),
                        ),
                ),
              ),

              // Content
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Category & Status Badges
                      Row(
                        children: [
                          if (category.isNotEmpty)
                            BadgeChip(
                              label: category,
                              color: Colors.orange,
                            ),
                          const SizedBox(width: 8),
                          BadgeChip(
                            label: statusLabel,
                            color: _statusColor(status),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // Title
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Creator Info
                      Row(
                        children: [
                          CircleAvatar(
                            radius: 18,
                            backgroundColor: Colors.grey[300],
                            backgroundImage:
                                clue['creator_avatar_url'] != null
                                    ? NetworkImage(
                                        clue['creator_avatar_url'])
                                    : null,
                            child: clue['creator_avatar_url'] == null
                                ? const Icon(Icons.person, size: 20)
                                : null,
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                clue['creator_name'] ?? '크리에이터',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600),
                              ),
                              Text(
                                '클루 제작자',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Description
                      if (description.isNotEmpty)
                        Text(
                          description,
                          style: const TextStyle(
                            fontSize: 15,
                            height: 1.6,
                          ),
                        ),
                      const SizedBox(height: 20),

                      const Divider(),
                      const SizedBox(height: 12),

                      // Participant Info
                      _InfoRow(
                        icon: Icons.people,
                        label: '참여자',
                        value: maxParticipants != null
                            ? '$participantCount / $maxParticipants명'
                            : '$participantCount명',
                      ),
                      const SizedBox(height: 8),

                      if (startsAt != null) ...[
                        _InfoRow(
                          icon: Icons.calendar_today,
                          label: '시작',
                          value: _formatDateTime(startsAt),
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (endsAt != null) ...[
                        _InfoRow(
                          icon: Icons.calendar_today,
                          label: '종료',
                          value: _formatDateTime(endsAt),
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (timeLimitMin != null)
                        _InfoRow(
                          icon: Icons.timer,
                          label: '제한시간',
                          value: _formatDuration(timeLimitMin),
                        ),
                      if (locationName.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        _InfoRow(
                          icon: Icons.location_on,
                          label: '장소',
                          value: locationName,
                        ),
                      ],
                      const SizedBox(height: 20),

                      const Divider(),
                      const SizedBox(height: 12),

                      // Step List
                      Text(
                        '스텝 목록 (${steps.length}개)',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      ...steps.asMap().entries.map((entry) {
                        final index = entry.key;
                        final step = entry.value;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Card(
                            elevation: 0,
                            color: AppColors.bgSurface,
                            child: ListTile(
                              leading: StepTypeIcon(
                                  stepType: step['type'] ?? ''),
                              title: Text(
                                'Step ${index + 1}: ${step['title'] ?? ''}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w500),
                              ),
                              subtitle: Text(
                                step['type'] ?? '',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                      const SizedBox(height: 20),

                      const Divider(),
                      const SizedBox(height: 12),

                      // Reward Info
                      const Text(
                        '보상',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Card(
                        elevation: 0,
                        color: Colors.amber[50],
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              const Icon(Icons.emoji_events,
                                  color: Colors.amber, size: 32),
                              const SizedBox(width: 12),
                              Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    rewardType.isNotEmpty
                                        ? _rewardTypeLabel(rewardType)
                                        : '포인트 보상',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 16,
                                    ),
                                  ),
                                  Text(rewardValue.isNotEmpty
                                      ? rewardValue
                                      : '완료 시 보상 지급'),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),

                      const Divider(),
                      const SizedBox(height: 12),

                      // Location Map Preview
                      const Text(
                        '위치',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        height: 180,
                        width: double.infinity,
                        decoration: BoxDecoration(
                          color: AppColors.bgSurface,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.map, size: 48, color: Colors.grey),
                              SizedBox(height: 8),
                              Text(
                                '지도 미리보기',
                                style: TextStyle(color: Colors.grey),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Bottom padding for CTA button
                      const SizedBox(height: 100),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // Fixed CTA Button
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                height: 56,
                child: ElevatedButton(
                  onPressed: () async {
                    final userId = ref.read(currentUserIdProvider);
                    if (userId == null) {
                      context.go('/auth');
                      return;
                    }

                    try {
                      final service =
                          ref.read(participationServiceProvider);
                      await service.joinClue(clueId: clueId, userId: userId);
                      ref.invalidate(myParticipationsProvider);
                      if (context.mounted) {
                        context.push('/clue/$clueId/play');
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('참여 실패: $e')),
                        );
                      }
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  child: const Text(
                    '참여하기',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'active':
        return '모집중';
      case 'draft':
        return '초안';
      case 'pending':
        return '승인대기';
      case 'completed':
        return '완료';
      case 'suspended':
        return '중지됨';
      default:
        return status;
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active':
        return Colors.green;
      case 'draft':
        return Colors.grey;
      case 'pending':
        return Colors.orange;
      case 'completed':
        return Colors.blue;
      case 'suspended':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  String _formatDateTime(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.year}.${dt.month.toString().padLeft(2, '0')}.${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }

  String _formatDuration(dynamic minutes) {
    final min = minutes is int ? minutes : int.tryParse('$minutes') ?? 0;
    if (min >= 60) {
      final h = min ~/ 60;
      final m = min % 60;
      return m > 0 ? '${h}시간 ${m}분' : '${h}시간';
    }
    return '${min}분';
  }

  String _rewardTypeLabel(String type) {
    switch (type) {
      case 'points':
        return '포인트 보상';
      case 'badge':
        return '배지 보상';
      case 'coupon':
        return '쿠폰 보상';
      case 'prize':
        return '상금 보상';
      case 'certificate':
        return '인증서';
      default:
        return '보상';
    }
  }

  void _showReportDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('신고하기'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('이 클루를 신고하시겠습니까?'),
            const SizedBox(height: 16),
            TextField(
              maxLines: 3,
              decoration: InputDecoration(
                hintText: '신고 사유를 입력해주세요',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('취소'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              try {
                final userId = safeClient.auth.currentUser?.id;
                if (userId == null) return;
                await ReportService().submitReport(
                  reporterId: userId,
                  targetType: 'clue',
                  targetId: clueId,
                  reason: 'other',
                );
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('신고가 접수되었습니다')),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('신고 실패: $e')),
                  );
                }
              }
            },
            child: const Text('신고'),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: AppColors.textSecondary),
        const SizedBox(width: 8),
        Text(
          label,
          style: TextStyle(
            color: AppColors.textSecondary,
            fontSize: 14,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}
