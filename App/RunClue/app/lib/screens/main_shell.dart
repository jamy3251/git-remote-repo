import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

/// 바텀 네비게이션 쉘 — PDF spec Section 3.1
/// 5탭: 탐색(HOME) / 참여(EXPLORE) / 제작(+) / 소통(RANK) / 내정보(MY XP)
/// 활성: #FACC15 + glow / 비활성: #555
class MainShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const MainShell({
    super.key,
    required this.navigationShell,
  });

  @override
  Widget build(BuildContext context) {
    final currentIndex = navigationShell.currentIndex;

    void _switchTab(int index, int current) {
      HapticFeedback.selectionClick();
      navigationShell.goBranch(index, initialLocation: index == current);
    }

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: AppColors.bgBase,
          border: Border(
            top: BorderSide(color: AppColors.borderSubtle),
          ),
        ),
        child: SafeArea(
          child: SizedBox(
            height: 64,
            child: Row(
              children: [
                _NavItem(
                  icon: Icons.local_fire_department_outlined,
                  activeIcon: Icons.local_fire_department,
                  label: 'HOME',
                  isActive: currentIndex == 0,
                  onTap: () => _switchTab(0, currentIndex),
                ),
                _NavItem(
                  icon: Icons.search_outlined,
                  activeIcon: Icons.search,
                  label: 'EXPLORE',
                  isActive: currentIndex == 1,
                  onTap: () => _switchTab(1, currentIndex),
                ),
                _NavItem(
                  icon: Icons.add_circle_outline,
                  activeIcon: Icons.add_circle,
                  label: 'CREATE',
                  isActive: currentIndex == 2,
                  onTap: () => _switchTab(2, currentIndex),
                ),
                _NavItem(
                  icon: Icons.emoji_events_outlined,
                  activeIcon: Icons.emoji_events,
                  label: 'RANK',
                  isActive: currentIndex == 3,
                  onTap: () => _switchTab(3, currentIndex),
                ),
                _NavItem(
                  icon: Icons.star_outline,
                  activeIcon: Icons.star,
                  label: 'MY XP',
                  isActive: currentIndex == 4,
                  onTap: () => _switchTab(4, currentIndex),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isActive ? AppColors.brandYellow : AppColors.textDisabled;

    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isActive ? activeIcon : icon,
              size: 22,
              color: color,
              shadows: isActive
                  ? [Shadow(color: AppColors.brandYellow.withValues(alpha: 0.6), blurRadius: 8)]
                  : null,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: GoogleFonts.notoSansKr(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w700 : FontWeight.w400,
                color: color,
                letterSpacing: 0.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
