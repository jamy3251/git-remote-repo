import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mytrainer/spotter/nv21.dart';

void main() {
  // 4x2 이미지. Y 는 행 끝에 패딩 2바이트, U/V 는 2x1 블록.
  final y = YuvPlane(Uint8List.fromList([1, 2, 3, 4, 0, 0, 5, 6, 7, 8, 0, 0]), 6);

  test('평면이 따로(픽셀 간격 1)', () {
    final u = YuvPlane(Uint8List.fromList([10, 11]), 2);
    final v = YuvPlane(Uint8List.fromList([20, 21]), 2);
    expect(yuv420ToNv21(4, 2, y, u, v), [1, 2, 3, 4, 5, 6, 7, 8, 20, 10, 21, 11]);
  });

  test('U/V 가 섞인 평면(픽셀 간격 2, 대부분의 폰)', () {
    // U 평면 = U0 V0 U1 (V1), V 평면 = V0 U1 V1 — 같은 버퍼를 한 칸 어긋나게 본다.
    final u = YuvPlane(Uint8List.fromList([10, 20, 11, 21]), 4, 2);
    final v = YuvPlane(Uint8List.fromList([20, 11, 21]), 4, 2);
    expect(yuv420ToNv21(4, 2, y, u, v), [1, 2, 3, 4, 5, 6, 7, 8, 20, 10, 21, 11]);
  });
}
