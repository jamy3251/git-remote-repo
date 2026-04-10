import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase 클라이언트를 안전하게 가져오는 헬퍼.
/// 초기화 안 됐으면 더미 클라이언트 반환 (UI 미리보기 모드).
SupabaseClient get safeClient {
  try {
    return Supabase.instance.client;
  } catch (_) {
    // UI 미리보기 모드 — 더미 클라이언트
    return SupabaseClient(
      'https://placeholder.supabase.co',
      'placeholder-key',
    );
  }
}
