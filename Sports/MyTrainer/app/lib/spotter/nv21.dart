import 'dart:typed_data';

/// 카메라 평면 하나(카메라 플러그인의 Plane 에서 필요한 것만).
class YuvPlane {
  const YuvPlane(this.bytes, this.bytesPerRow, [this.bytesPerPixel = 1]);

  final Uint8List bytes;
  final int bytesPerRow;
  final int bytesPerPixel;
}

/// YUV_420_888(CameraX 기본) → NV21(ML Kit 안드로이드가 받는 형식).
///
/// NV21 = Y 전체 다음에 V,U 를 번갈아(2x2 블록당 한 쌍). 행 끝 패딩(bytesPerRow)과
/// U/V 평면의 픽셀 간격(bytesPerPixel: 1이면 따로, 2면 섞여 있음)을 모두 처리한다.
Uint8List yuv420ToNv21(int width, int height, YuvPlane y, YuvPlane u, YuvPlane v) {
  final out = Uint8List(width * height + 2 * (width ~/ 2) * (height ~/ 2));
  var o = 0;
  for (var row = 0; row < height; row++) {
    final start = row * y.bytesPerRow;
    out.setRange(o, o + width, y.bytes, start);
    o += width;
  }
  for (var row = 0; row < height ~/ 2; row++) {
    for (var col = 0; col < width ~/ 2; col++) {
      out[o++] = v.bytes[row * v.bytesPerRow + col * v.bytesPerPixel];
      out[o++] = u.bytes[row * u.bytesPerRow + col * u.bytesPerPixel];
    }
  }
  return out;
}
