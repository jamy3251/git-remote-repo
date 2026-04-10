import '../config/supabase_safe.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class StepService {
  final SupabaseClient _client = safeClient;

  /// Get all steps for a clue, ordered by order_index.
  Future<List<Map<String, dynamic>>> getStepsByClueId(String clueId) async {
    try {
      final response = await _client
          .from('steps')
          .select('*')
          .eq('clue_id', clueId)
          .order('order_index', ascending: true);
      return List<Map<String, dynamic>>.from(response);
    } catch (e) {
      throw Exception('Failed to fetch steps: $e');
    }
  }

  /// Create a new step.
  Future<Map<String, dynamic>> createStep(Map<String, dynamic> stepData) async {
    try {
      final response = await _client
          .from('steps')
          .insert(stepData)
          .select()
          .single();
      return response;
    } catch (e) {
      throw Exception('Failed to create step: $e');
    }
  }

  /// Update an existing step.
  Future<Map<String, dynamic>> updateStep(
    String id,
    Map<String, dynamic> fields,
  ) async {
    try {
      final response = await _client
          .from('steps')
          .update(fields)
          .eq('id', id)
          .select()
          .single();
      return response;
    } catch (e) {
      throw Exception('Failed to update step: $e');
    }
  }

  /// Delete a step by ID.
  Future<void> deleteStep(String id) async {
    try {
      await _client.from('steps').delete().eq('id', id);
    } catch (e) {
      throw Exception('Failed to delete step: $e');
    }
  }

  /// Reorder steps for a clue by updating their order_index values.
  ///
  /// [stepOrders] is a list of maps with 'id' and 'order_index' keys.
  Future<void> reorderSteps(
    String clueId,
    List<Map<String, dynamic>> stepOrders,
  ) async {
    try {
      for (final order in stepOrders) {
        await _client
            .from('steps')
            .update({'order_index': order['order_index']})
            .eq('id', order['id'])
            .eq('clue_id', clueId);
      }
    } catch (e) {
      throw Exception('Failed to reorder steps: $e');
    }
  }
}
