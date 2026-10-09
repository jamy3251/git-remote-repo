import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'bootstrap/firebase_bootstrap.dart';
import 'core/updater.dart';
import 'machines/machines_state.dart';
import 'party/party_state.dart';
import 'routines/routines_state.dart';
import 'services/reminders.dart';
import 'state/attendance.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await initializeDateFormatting('ko_KR');
  await Reminders.instance.init();
  await Updater.instance.init();

  final prefs = await SharedPreferences.getInstance();

  // Firebase 설정이 있으면 서버에, 없으면 이 폰에만 저장한다. 앱 동작은 같다.
  final (repository, mode) = await createRepository(prefs);
  final party = createPartyRepository(prefs, mode);

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repository),
        syncModeProvider.overrideWithValue(mode),
        partyRepositoryProvider.overrideWithValue(party),
        machineRepositoryProvider.overrideWithValue(createMachineRepository(prefs, party)),
        routineRepositoryProvider.overrideWithValue(createRoutineRepository(prefs, mode)),
        routineExtractorProvider.overrideWithValue(createRoutineExtractor(mode)),
      ],
      child: const MyTrainerApp(),
    ),
  );
}
