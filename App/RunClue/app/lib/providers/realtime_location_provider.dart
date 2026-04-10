import '../config/supabase_safe.dart';
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// 참여자 위치를 Supabase Presence(Broadcast) 채널로 공유/수신하는 Provider.
///
/// Eng Review 결정: 채널 2 = 'location:{clueId}' (Presence)
/// Host: 전체 참여자 위치 수신
/// Participant: 본인 위치만 전송, 목표지점 표시

class ParticipantLocation {
  final String userId;
  final String? nickname;
  final double latitude;
  final double longitude;
  final DateTime timestamp;

  ParticipantLocation({
    required this.userId,
    this.nickname,
    required this.latitude,
    required this.longitude,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 특정 클루의 참여자 위치 맵을 실시간으로 관리
final realtimeLocationProvider = StateNotifierProvider.family<
    RealtimeLocationNotifier, Map<String, ParticipantLocation>, String>(
  (ref, clueId) => RealtimeLocationNotifier(clueId, ref),
);

class RealtimeLocationNotifier
    extends StateNotifier<Map<String, ParticipantLocation>> {
  final String clueId;
  final Ref ref;
  RealtimeChannel? _channel;
  Timer? _broadcastTimer;

  RealtimeLocationNotifier(this.clueId, this.ref)
      : super({}) {
    _subscribe();
  }

  void _subscribe() {
    final client = safeClient;
    _channel = client.channel('location:$clueId');

    // 다른 참여자의 위치 수신
    _channel!.onBroadcast(
      event: 'location_update',
      callback: (payload) {
        final userId = payload['user_id'] as String?;
        if (userId == null) return;

        state = {
          ...state,
          userId: ParticipantLocation(
            userId: userId,
            nickname: payload['nickname'] as String?,
            latitude: (payload['lat'] as num).toDouble(),
            longitude: (payload['lng'] as num).toDouble(),
          ),
        };
      },
    );

    _channel!.subscribe();
  }

  /// 본인 위치를 브로드캐스트한다. 10m 이동마다 호출.
  void broadcastLocation({
    required String userId,
    String? nickname,
    required double latitude,
    required double longitude,
  }) {
    _channel?.sendBroadcastMessage(
      event: 'location_update',
      payload: {
        'user_id': userId,
        'nickname': nickname,
        'lat': latitude,
        'lng': longitude,
        'ts': DateTime.now().toIso8601String(),
      },
    );

    // 로컬 상태도 업데이트
    state = {
      ...state,
      userId: ParticipantLocation(
        userId: userId,
        nickname: nickname,
        latitude: latitude,
        longitude: longitude,
      ),
    };
  }

  @override
  void dispose() {
    _broadcastTimer?.cancel();
    if (_channel != null) {
      safeClient.removeChannel(_channel!);
    }
    super.dispose();
  }
}
