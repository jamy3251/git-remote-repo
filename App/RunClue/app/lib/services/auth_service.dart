import '../config/supabase_safe.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class AuthService {
  final SupabaseClient _client = safeClient;

  // Current user
  User? get currentUser => _client.auth.currentUser;
  String? get currentUserId => currentUser?.id;
  bool get isLoggedIn => currentUser != null;

  // Auth state stream
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  // Sign up with email
  Future<AuthResponse> signUpWithEmail({
    required String email,
    required String password,
    required String nickname,
  }) async {
    final response = await _client.auth.signUp(
      email: email,
      password: password,
      data: {'nickname': nickname},
    );
    return response;
  }

  // Sign in with email
  Future<AuthResponse> signInWithEmail({
    required String email,
    required String password,
  }) async {
    return await _client.auth.signInWithPassword(
      email: email,
      password: password,
    );
  }

  // Sign in with OAuth (Kakao, Google, etc.)
  Future<bool> signInWithOAuth(OAuthProvider provider) async {
    return await _client.auth.signInWithOAuth(provider);
  }

  // Sign out
  Future<void> signOut() async {
    await _client.auth.signOut();
  }

  // Password reset
  Future<void> resetPassword(String email) async {
    await _client.auth.resetPasswordForEmail(email);
  }
}
