import 'rep_counter.dart';

/// 스포터 한 번의 관절 좌표 녹화(영상 아님). 반복 카운터 정확도 하네스의 재료(D15).
///
/// [truth] 는 확인 화면에서 사람이 고친 최종 횟수. 촬영자 폰의 앱 전용 폴더
/// (Android/data/com.mytrainer.mytrainer/files/spotter_recordings)에 남고, adb pull 로 가져가
/// tool/accuracy/squat/{tune,holdout}/ 에 나눠 넣는다.
class PoseRecording {
  PoseRecording({required this.frames, required this.counted, required this.truth, required this.at});

  final List<PoseFrame> frames;
  final int counted;
  final int truth;
  final DateTime at;

  Map<String, dynamic> toJson() => {
        'version': 1,
        'at': at.toIso8601String(),
        'counted': counted,
        'truth': truth,
        'joints': [for (final j in Joint.values) j.name],
        'frames': [for (final f in frames) f.toJson()],
      };

  factory PoseRecording.fromJson(Map<String, dynamic> j) => PoseRecording(
        frames: [for (final f in j['frames'] as List) PoseFrame.fromJson(f as List)],
        counted: (j['counted'] as num).toInt(),
        truth: (j['truth'] as num).toInt(),
        at: DateTime.parse(j['at'] as String),
      );
}
