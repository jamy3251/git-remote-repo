import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// 팔레트.
///
/// Familyeat 팔레트를 그대로 가져왔다. 헬스장에서 세트 사이에 흘끗 보는
/// 화면이라 색이 소리치면 숫자가 안 보인다. 깊은 틸 하나로 주조를 잡고,
/// 앰버는 개인 기록 갱신처럼 "좋은 소식"에만 쓴다.
class AppColors {
  const AppColors._();

  // 주조색
  static const teal = Color(0xFF157F6E);
  static const tealDeep = Color(0xFF0E5F52);
  static const tealSoft = Color(0xFFE4F0ED);
  static const tealLine = Color(0xFFBFDCD5);

  // 강조
  static const amber = Color(0xFFE9A33C);
  static const amberSoft = Color(0xFFFBF1DF);
  static const coral = Color(0xFFE05B4F);
  static const coralSoft = Color(0xFFFBEBE9);
  static const plum = Color(0xFF7A5AA8);
  static const plumSoft = Color(0xFFF0EBF8);

  // 텍스트 — 따뜻한 먹색 계열
  static const ink = Color(0xFF1A1A1F);
  static const inkSub = Color(0xFF5F6168);
  static const inkFaint = Color(0xFF9A9CA3);

  // 배경 — 순회색이 아니라 살짝 따뜻한 뉴트럴
  static const bg = Color(0xFFF8F6F3);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceAlt = Color(0xFFF2EFEA);
  static const line = Color(0xFFE8E4DE);
  static const lineSoft = Color(0xFFF0EDE8);

  /// 구성원 아바타 색. 채도를 낮춰서 나란히 놓아도 시끄럽지 않게.
  static const memberPalette = <Color>[
    Color(0xFF157F6E),
    Color(0xFFD97742),
    Color(0xFF7A5AA8),
    Color(0xFF3D6FB4),
    Color(0xFFC65B7C),
    Color(0xFF5E8C41),
    Color(0xFFB8892B),
    Color(0xFF2E8B8B),
  ];

  static Color member(int index) =>
      memberPalette[index.abs() % memberPalette.length];
}

/// 타입 스케일.
///
/// 폰트는 Pretendard 하나만 쓰고, 위계는 **굵기와 자간**으로 만든다.
/// 서체를 섞는 것보다 웨이트 사다리를 제대로 쓰는 쪽이 훨씬 정돈돼 보인다.
/// 큰 글자일수록 자간을 좁혀야 뭉치지 않고 단단해 보인다.
class AppText {
  const AppText._();

  static const _f = 'Pretendard';

  /// 화면당 하나. 시선이 처음 닿는 자리.
  static const display = TextStyle(
    fontFamily: _f,
    fontSize: 27,
    height: 1.28,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.7,
    color: AppColors.ink,
  );

  static const title = TextStyle(
    fontFamily: _f,
    fontSize: 21,
    height: 1.32,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
    color: AppColors.ink,
  );

  static const headline = TextStyle(
    fontFamily: _f,
    fontSize: 17.5,
    height: 1.38,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.35,
    color: AppColors.ink,
  );

  static const section = TextStyle(
    fontFamily: _f,
    fontSize: 15.5,
    height: 1.4,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.25,
    color: AppColors.ink,
  );

  static const body = TextStyle(
    fontFamily: _f,
    fontSize: 15,
    height: 1.56,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.15,
    color: AppColors.ink,
  );

  static const bodyStrong = TextStyle(
    fontFamily: _f,
    fontSize: 15,
    height: 1.5,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: AppColors.ink,
  );

  static const label = TextStyle(
    fontFamily: _f,
    fontSize: 13.5,
    height: 1.45,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.1,
    color: AppColors.inkSub,
  );

  static const labelStrong = TextStyle(
    fontFamily: _f,
    fontSize: 13.5,
    height: 1.4,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.15,
    color: AppColors.ink,
  );

  static const caption = TextStyle(
    fontFamily: _f,
    fontSize: 12,
    height: 1.42,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.05,
    color: AppColors.inkFaint,
  );

  /// 아주 작은 라벨. 자간을 살짝 벌려야 읽힌다.
  static const micro = TextStyle(
    fontFamily: _f,
    fontSize: 10.5,
    height: 1.3,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.3,
    color: AppColors.inkFaint,
  );

  /// 금액. 숫자 폭을 고정해서 세로로 나란히 놓았을 때 흔들리지 않게 한다.
  static const money = TextStyle(
    fontFamily: _f,
    fontSize: 15.5,
    height: 1.3,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
    color: AppColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  static const moneyLarge = TextStyle(
    fontFamily: _f,
    fontSize: 24,
    height: 1.25,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.8,
    color: AppColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );
}

/// 4pt 배수 간격. 임의의 숫자를 쓰지 않기 위한 눈금.
class Gap {
  const Gap._();
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 28.0;
  static const huge = 40.0;
}

/// 라운드는 요소 크기에 따라 달라야 한다.
/// 전부 같은 값을 쓰면 화면 전체가 물렁해 보인다.
class Radii {
  const Radii._();
  static const chip = 999.0;
  static const small = 8.0;
  static const card = 14.0;
  static const panel = 20.0;
  static const sheet = 26.0;
}

ThemeData buildAppTheme() {
  const scheme = ColorScheme.light(
    primary: AppColors.teal,
    onPrimary: Colors.white,
    secondary: AppColors.amber,
    onSecondary: AppColors.ink,
    surface: AppColors.surface,
    onSurface: AppColors.ink,
    error: AppColors.coral,
    onError: Colors.white,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,
    fontFamily: 'Pretendard',
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: AppColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      // 본문 좌우 여백(Gap.xl)과 같은 값. 뒤로가기 버튼이 없는 탭 화면에서
      // 제목이 본문 첫 글자와 정확히 같은 세로선에 선다.
      titleSpacing: Gap.xl,
      titleTextStyle: AppText.headline,
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.lineSoft,
      thickness: 1,
      space: 1,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.teal,
        foregroundColor: Colors.white,
        disabledBackgroundColor: AppColors.line,
        disabledForegroundColor: AppColors.inkFaint,
        minimumSize: const Size.fromHeight(52),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.card)),
        textStyle: const TextStyle(
          fontFamily: 'Pretendard',
          fontSize: 15.5,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.ink,
        backgroundColor: AppColors.surface,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: AppColors.line, width: 1.3),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.card)),
        textStyle: const TextStyle(
          fontFamily: 'Pretendard',
          fontSize: 15,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.25,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.tealDeep,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        minimumSize: const Size(48, 44),
        textStyle: const TextStyle(
          fontFamily: 'Pretendard',
          fontSize: 13.5,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.15,
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surfaceAlt,
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 15, vertical: 15),
      hintStyle: AppText.body.copyWith(color: AppColors.inkFaint),
      labelStyle: AppText.label,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.card),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.card),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.card),
        borderSide: const BorderSide(color: AppColors.teal, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.card),
        borderSide: const BorderSide(color: AppColors.coral, width: 1.3),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(Radii.card),
        borderSide: const BorderSide(color: AppColors.coral, width: 1.6),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.sheet)),
      ),
      showDragHandle: true,
      dragHandleColor: AppColors.line,
      dragHandleSize: Size(36, 4),
    ),
    dialogTheme: DialogTheme(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      shape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.panel)),
      titleTextStyle: AppText.headline,
      contentTextStyle: AppText.body,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.ink,
      contentTextStyle: AppText.bodyStrong.copyWith(color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.card)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Colors.transparent,
      height: 62,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontFamily: 'Pretendard',
          fontSize: 10.5,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          letterSpacing: -0.1,
          color: selected ? AppColors.ink : AppColors.inkFaint,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 23,
          color: selected ? AppColors.teal : AppColors.inkFaint,
        );
      }),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: AppColors.surfaceAlt,
      selectedColor: AppColors.tealSoft,
      side: BorderSide.none,
      showCheckmark: false,
      labelStyle: AppText.label,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      shape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.chip)),
    ),
  );
}

/// 카드는 그림자 대신 얇은 선으로 띄운다.
/// 그림자를 겹겹이 쌓으면 화면이 지저분해지고, 선은 위계를 정확히 만든다.
const kCardBorder = Border.fromBorderSide(
  BorderSide(color: AppColors.line, width: 1),
);

/// 떠 있어야 하는 것(바텀시트, 스낵바)에만 쓰는 아주 옅은 그림자.
const kLiftShadow = <BoxShadow>[
  BoxShadow(color: Color(0x0F1A1A1F), blurRadius: 16, offset: Offset(0, 4)),
];
