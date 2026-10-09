import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_pose_detection/google_mlkit_pose_detection.dart';

import 'nv21.dart';
import 'rep_counter.dart';

/// 카메라 → 포즈 프레임. 테스트에서는 녹화된(합성) 프레임으로 바꿔 끼운다.
abstract class PoseSource {
  Future<void> start();

  Stream<PoseFrame> get frames;

  /// 카메라 미리보기. 시작 전이면 빈 화면.
  Widget preview();

  Future<void> stop();
}

/// 후면 카메라 720p + ML Kit 포즈(스트림 모드).
///
/// 처리 중이면 새 프레임은 버리고 다음 것을 받는다. 밀린 프레임을 쌓으면 지연이 계속
/// 늘어나서, 반복 수가 실제보다 늦게 오르고 끝 무렵 프레임을 놓친다(설계 Performance).
class MlKitPoseSource implements PoseSource {
  CameraController? _camera;
  final _detector = PoseDetector(options: PoseDetectorOptions(mode: PoseDetectionMode.stream));
  final _out = StreamController<PoseFrame>.broadcast();
  final _clock = Stopwatch();
  bool _busy = false;
  int dropped = 0;

  static const _joints = {
    PoseLandmarkType.leftHip: Joint.leftHip,
    PoseLandmarkType.leftKnee: Joint.leftKnee,
    PoseLandmarkType.leftAnkle: Joint.leftAnkle,
    PoseLandmarkType.rightHip: Joint.rightHip,
    PoseLandmarkType.rightKnee: Joint.rightKnee,
    PoseLandmarkType.rightAnkle: Joint.rightAnkle,
  };

  @override
  Stream<PoseFrame> get frames => _out.stream;

  @override
  Future<void> start() async {
    final cams = await availableCameras();
    final back = cams.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => cams.first);
    final c = CameraController(
      back,
      ResolutionPreset.high,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.yuv420,
    );
    await c.initialize();
    _camera = c;
    _clock.start();
    final rotation =
        InputImageRotationValue.fromRawValue(back.sensorOrientation) ?? InputImageRotation.rotation90deg;
    await c.startImageStream((img) => _onImage(img, rotation));
  }

  Future<void> _onImage(CameraImage img, InputImageRotation rotation) async {
    if (_busy) {
      dropped++;
      return;
    }
    _busy = true;
    final t = _clock.elapsedMilliseconds;
    try {
      final p = img.planes;
      YuvPlane plane(Plane x) => YuvPlane(x.bytes, x.bytesPerRow, x.bytesPerPixel ?? 1);
      final bytes = p.length == 1
          ? p[0].bytes // 이미 NV21 로 오는 기기
          : yuv420ToNv21(img.width, img.height, plane(p[0]), plane(p[1]), plane(p[2]));
      final input = InputImage.fromBytes(
        bytes: bytes,
        metadata: InputImageMetadata(
          size: Size(img.width.toDouble(), img.height.toDouble()),
          rotation: rotation,
          format: InputImageFormat.nv21,
          bytesPerRow: img.width,
        ),
      );
      final poses = await _detector.processImage(input);
      if (poses.isEmpty) {
        _out.add(PoseFrame(t, const {}));
      } else {
        final lm = poses.first.landmarks;
        _out.add(PoseFrame(t, {
          for (final e in _joints.entries)
            if (lm[e.key] case final l?) e.value: Pt(l.x, l.y, l.likelihood),
        }));
      }
    } catch (e) {
      debugPrint('포즈 처리 실패: $e');
    } finally {
      _busy = false;
    }
  }

  @override
  Widget preview() {
    final c = _camera;
    if (c == null || !c.value.isInitialized) return const ColoredBox(color: Colors.black);
    return CameraPreview(c);
  }

  @override
  Future<void> stop() async {
    final c = _camera;
    _camera = null;
    try {
      if (c != null && c.value.isStreamingImages) await c.stopImageStream();
    } catch (_) {}
    await c?.dispose();
    await _detector.close();
    await _out.close();
  }
}
