import '../config/supabase_safe.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ClueService {
  final SupabaseClient _client = safeClient;

  /// List clues with optional filtering and pagination.
  Future<List<Map<String, dynamic>>> getClues({
    String? category,
    String? status,
    int limit = 20,
    int offset = 0,
  }) async {
    try {
      var query = _client
          .from('clues')
          .select('*, steps(count)');

      if (category != null) {
        query = query.eq('category', category);
      }
      if (status != null) {
        query = query.eq('status', status);
      } else {
        query = query.eq('status', 'active');
      }

      final response = await query
          .order('created_at', ascending: false)
          .range(offset, offset + limit - 1);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to fetch clues: $e');
    }
  }

  /// Get nearby clues using the nearby_clues RPC function.
  Future<List<Map<String, dynamic>>> getNearbyClues(
    double lat,
    double lng,
    double radiusKm,
  ) async {
    try {
      final response = await _client.rpc('nearby_clues', params: {
        'lat': lat,
        'lng': lng,
        'radius_km': radiusKm,
      });
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to fetch nearby clues: $e');
    }
  }

  /// Get a single clue by ID with its steps joined.
  Future<Map<String, dynamic>?> getClueById(String id) async {
    try {
      final response = await _client
          .from('clues')
          .select('*, steps(*)')
          .eq('id', id)
          .single();
      return response;
    } catch (e) {
      throw Exception('Failed to fetch clue: $e');
    }
  }

  /// Get clues created by a specific user.
  Future<List<Map<String, dynamic>>> getMyClues(String userId) async {
    try {
      final response = await _client
          .from('clues')
          .select('*, steps(count)')
          .eq('creator_id', userId)
          .order('created_at', ascending: false);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to fetch user clues: $e');
    }
  }

  /// Create a new clue.
  Future<Map<String, dynamic>> createClue(Map<String, dynamic> clueData) async {
    try {
      final response = await _client
          .from('clues')
          .insert(clueData)
          .select()
          .single();
      return response;
    } catch (e) {
      throw Exception('Failed to create clue: $e');
    }
  }

  /// Update an existing clue.
  Future<Map<String, dynamic>> updateClue(
    String id,
    Map<String, dynamic> fields,
  ) async {
    try {
      final response = await _client
          .from('clues')
          .update(fields)
          .eq('id', id)
          .select()
          .single();
      return response;
    } catch (e) {
      throw Exception('Failed to update clue: $e');
    }
  }

  /// Soft-delete a clue by setting its status to suspended.
  Future<void> deleteClue(String id) async {
    try {
      await _client
          .from('clues')
          .update({'status': 'suspended'})
          .eq('id', id);
    } catch (e) {
      throw Exception('Failed to delete clue: $e');
    }
  }

  /// Text search across clue titles and descriptions.
  Future<List<Map<String, dynamic>>> searchClues(String query) async {
    try {
      final response = await _client
          .from('clues')
          .select('*, steps(count)')
          .eq('status', 'active')
          .or('title.ilike.%$query%,description.ilike.%$query%')
          .order('created_at', ascending: false)
          .limit(50);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to search clues: $e');
    }
  }

  /// Get trending clues sorted by view and like counts.
  Future<List<Map<String, dynamic>>> getTrendingClues({int limit = 20}) async {
    try {
      final response = await _client
          .from('clues')
          .select('*, steps(count)')
          .eq('status', 'active')
          .order('view_count', ascending: false)
          .order('like_count', ascending: false)
          .limit(limit);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to fetch trending clues: $e');
    }
  }

  /// Increment the view count for a clue.
  Future<void> incrementViewCount(String id) async {
    try {
      await _client.rpc('increment_view_count', params: {'clue_id': id});
    } catch (e) {
      // Silently fail – view count is non-critical.
    }
  }

  /// Toggle like/unlike for a clue. Returns true if liked, false if unliked.
  Future<bool> toggleLike(String clueId, String userId) async {
    try {
      final existing = await _client
          .from('likes')
          .select('id')
          .eq('target_type', 'clue')
          .eq('target_id', clueId)
          .eq('user_id', userId)
          .maybeSingle();

      if (existing != null) {
        await _client
            .from('likes')
            .delete()
            .eq('id', existing['id']);
        return false;
      } else {
        await _client.from('likes').insert({
          'user_id': userId,
          'target_type': 'clue',
          'target_id': clueId,
        });
        return true;
      }
    } catch (e) {
      throw Exception('Failed to toggle like: $e');
    }
  }
}
