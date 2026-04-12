import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app.dart';
import 'config/supabase_config.dart';

Future<void> main() async {
  // 전역 에러 핸들링 — 크래시 방지
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();

    // Supabase 초기화 — 실패해도 앱은 실행
    try {
      if (SupabaseConfig.url.isNotEmpty &&
          !SupabaseConfig.url.contains('your-project') &&
          SupabaseConfig.anonKey.isNotEmpty) {
        await Supabase.initialize(
          url: SupabaseConfig.url,
          anonKey: SupabaseConfig.anonKey,
        );
        debugPrint('Supabase initialized: ${SupabaseConfig.url}');
      } else {
        debugPrint('Supabase skipped — no valid config');
      }
    } catch (e) {
      debugPrint('Supabase init failed (UI preview mode): $e');
    }

    runApp(
      const ProviderScope(
        child: RunClueApp(),
      ),
    );
  }, (error, stack) {
    debugPrint('Uncaught error: $error');
    debugPrint('Stack: $stack');
  });
}
