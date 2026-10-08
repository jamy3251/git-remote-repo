import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/theme.dart';
import 'state/attendance.dart';
import 'ui/home/home_screen.dart';
import 'ui/log/log_screen.dart';
import 'ui/machines/machines_screen.dart';
import 'ui/machines/register_machine_screen.dart';
import 'ui/party/party_screen.dart';
import 'ui/routines/import_routine_screen.dart';
import 'ui/routines/routines_screen.dart';
import 'ui/spotter/spot_confirm_screen.dart';
import 'ui/spotter/spotter_screen.dart';
import 'ui/onboarding/onboarding_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final onboarded = ValueNotifier(ref.read(onboardedProvider));
  ref.listen(onboardedProvider, (_, v) => onboarded.value = v);
  ref.onDispose(onboarded.dispose);

  return GoRouter(
    refreshListenable: onboarded,
    redirect: (_, state) {
      final atOnboarding = state.matchedLocation == '/onboarding';
      if (!onboarded.value && !atOnboarding) return '/onboarding';
      if (onboarded.value && atOnboarding) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const HomeScreen()),
      GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingScreen()),
      GoRoute(path: '/log', builder: (_, __) => const LogScreen()),
      GoRoute(path: '/machines', builder: (_, __) => const MachinesScreen()),
      GoRoute(path: '/machines/new', builder: (_, __) => const RegisterMachineScreen()),
      GoRoute(path: '/party', builder: (_, __) => const PartyScreen()),
      GoRoute(path: '/routines', builder: (_, __) => const RoutinesScreen()),
      GoRoute(path: '/routines/import', builder: (_, __) => const ImportRoutineScreen()),
      GoRoute(path: '/spotter', builder: (_, __) => const SpotterScreen()),
      GoRoute(
        path: '/spots/confirm',
        builder: (_, state) => SpotConfirmScreen(draft: state.extra! as SpotDraft),
      ),
    ],
  );
});

class MyTrainerApp extends ConsumerWidget {
  const MyTrainerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
        title: 'MyTrainer',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        routerConfig: ref.watch(routerProvider),
        locale: const Locale('ko', 'KR'),
        supportedLocales: const [Locale('ko', 'KR')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      );
}
