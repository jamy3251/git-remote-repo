import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'pose_source.dart';
import 'recordings.dart';
import 'rep_counter.dart';

/// 스포터 화면을 열 때마다 새 카메라 세션. 테스트에서는 합성 프레임으로 바꾼다.
final poseSourceFactoryProvider = Provider<PoseSource Function()>((_) => MlKitPoseSource.new);

final recordingStoreProvider = Provider((_) => RecordingStore());

/// 각도 임계값. tool/accuracy/rep_eval.dart 로 정한 값을 넣는다.
final repCounterConfigProvider = Provider((_) => const RepCounterConfig());
