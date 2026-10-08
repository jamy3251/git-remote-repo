import 'package:flutter/services.dart';

/// 사진 한 장 → 특징 벡터.
abstract class Embedder {
  /// 벡터를 만든 모델. 다른 모델 벡터와는 비교하지 않는다(설계 D5).
  String get modelId;

  Future<List<double>> embed(String imagePath);
}

/// Kotlin MachineEmbedder(MediaPipe Image Embedder)를 부른다.
class MediaPipeEmbedder implements Embedder {
  const MediaPipeEmbedder([this._channel = const MethodChannel('mytrainer/embedder')]);

  final MethodChannel _channel;

  /// 모델 파일 sha256 앞 8자리까지 넣는다. 같은 이름의 다른 파일과 섞이지 않게.
  /// tool/accuracy/embed_photos.py 의 MODEL_ID 와 같아야 한다.
  static const id = 'mp-mobilenet_v3_small-f32-v1-bbbb4c51';

  @override
  String get modelId => id;

  @override
  Future<List<double>> embed(String imagePath) async {
    final v = await _channel.invokeListMethod<double>('embed', {'path': imagePath});
    if (v == null || v.isEmpty) throw StateError('임베딩이 비었어요');
    return v;
  }
}
