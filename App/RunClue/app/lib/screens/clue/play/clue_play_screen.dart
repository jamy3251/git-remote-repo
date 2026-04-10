import '../../../config/theme.dart';
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../../../providers/auth_provider.dart';
import '../../../providers/clue_provider.dart';
import '../../../providers/participation_provider.dart';
import '../../../services/evidence_service.dart';
import '../../../services/location_service.dart';
import '../../../services/participation_service.dart';
import '../../../services/storage_service.dart';
import '../../../widgets/common/loading_widget.dart';
import '../../../widgets/common/error_widget.dart' as app;
import '../../../widgets/step_type_icon.dart';

class CluePlayScreen extends ConsumerStatefulWidget {
  final String clueId;

  const CluePlayScreen({
    super.key,
    required this.clueId,
  });

  @override
  ConsumerState<CluePlayScreen> createState() => _CluePlayScreenState();
}

class _CluePlayScreenState extends ConsumerState<CluePlayScreen> {
  int _currentStep = 0;
  bool _showHint = false;
  bool _isSubmitting = false;
  final _answerController = TextEditingController();
  bool? _oxAnswer;
  XFile? _capturedImage;
  double? _distanceToTarget;
  bool _checkpointArrived = false;
  List<Map<String, dynamic>> _checklistState = [];
  Map<String, bool> _stepCompleted = {};

  // Timer
  Timer? _timer;
  Duration _elapsed = Duration.zero;
  DateTime? _startedAt;

  // Data
  List<Map<String, dynamic>> _steps = [];
  Map<String, dynamic>? _participation;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _answerController.dispose();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final userId = ref.read(currentUserIdProvider);
      if (userId == null) return;

      final clueDetail =
          await ref.read(clueDetailProvider(widget.clueId).future);
      final participation = await ref
          .read(currentParticipationProvider(widget.clueId).future);

      if (clueDetail == null) {
        setState(() {
          _error = '클루를 찾을 수 없습니다';
          _isLoading = false;
        });
        return;
      }

      final steps = (clueDetail['steps'] as List<dynamic>?)
              ?.cast<Map<String, dynamic>>() ??
          [];
      steps.sort((a, b) =>
          (a['order_index'] as int? ?? 0)
              .compareTo(b['order_index'] as int? ?? 0));

      setState(() {
        _steps = steps;
        _participation = participation;
        _currentStep = participation?['current_step_index'] ?? 0;
        _isLoading = false;
        _startedAt = DateTime.now();
      });

      _startTimer();
      _initChecklistForCurrentStep();
    } catch (e) {
      setState(() {
        _error = '데이터를 불러올 수 없습니다';
        _isLoading = false;
      });
    }
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_startedAt != null) {
        setState(() {
          _elapsed = DateTime.now().difference(_startedAt!);
        });
      }
    });
  }

  void _initChecklistForCurrentStep() {
    if (_currentStep < _steps.length) {
      final step = _steps[_currentStep];
      if (step['type'] == 'LIST' && step['checklist_items'] != null) {
        final items = step['checklist_items'] as List<dynamic>;
        _checklistState = items
            .map((item) => {
                  'text': item is Map ? item['text'] ?? item.toString() : item.toString(),
                  'checked': false,
                })
            .toList();
      }
    }
  }

  Map<String, dynamic> get _currentStepData =>
      _currentStep < _steps.length ? _steps[_currentStep] : {};

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(body: LoadingWidget(message: '클루 로딩 중...'));
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(),
        body: app.AppErrorWidget(
          message: _error!,
          onRetry: () {
            setState(() {
              _isLoading = true;
              _error = null;
            });
            _loadData();
          },
        ),
      );
    }
    if (_steps.isEmpty) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: Text('스텝이 없는 클루입니다')),
      );
    }

    final totalSteps = _steps.length;
    final stepData = _currentStepData;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => _showExitConfirmation(context),
        ),
        title: Text('Step ${_currentStep + 1} / $totalSteps'),
        centerTitle: true,
        elevation: 0,
      ),
      body: Column(
        children: [
          LinearProgressIndicator(
            value: (_currentStep + 1) / totalSteps,
            backgroundColor: AppColors.bgSurface,
            minHeight: 4,
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      StepTypeIcon(stepType: stepData['type'] ?? ''),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          stepData['title'] ?? 'Step ${_currentStep + 1}',
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      if (_stepCompleted[stepData['id']] == true)
                        const Icon(Icons.check_circle,
                            color: Colors.green, size: 28),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue[50],
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      stepData['instruction'] ??
                          stepData['description'] ??
                          '이 스텝을 완료하세요',
                      style: const TextStyle(fontSize: 16, height: 1.5),
                    ),
                  ),
                  const SizedBox(height: 24),
                  _buildStepContent(),
                  const SizedBox(height: 24),

                  // Hint
                  // TODO: Phase 2 — XP 소모 후 추가 힌트 잠금해제
                  if (stepData['hint'] != null) ...[
                    InkWell(
                      onTap: () =>
                          setState(() => _showHint = !_showHint),
                      borderRadius: BorderRadius.circular(8),
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.amber[50],
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.amber[200]!),
                        ),
                        child: Row(
                          children: [
                            Icon(Icons.lightbulb,
                                color: Colors.amber[700], size: 20),
                            const SizedBox(width: 8),
                            Text(
                              _showHint ? '힌트 숨기기' : '힌트 보기',
                              style: TextStyle(
                                color: Colors.amber[800],
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_showHint) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.amber[50],
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          stepData['hint'] ?? '',
                          style: const TextStyle(fontSize: 14),
                        ),
                      ),
                    ],
                  ],
                  const SizedBox(height: 32),

                  // Submit Button
                  SizedBox(
                    height: 52,
                    child: ElevatedButton(
                      onPressed: _isSubmitting ? null : _handleSubmit,
                      style: ElevatedButton.styleFrom(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: _isSubmitting
                          ? const SizedBox(
                              height: 24,
                              width: 24,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white),
                            )
                          : Text(
                              _currentStep == totalSteps - 1
                                  ? '완료하기'
                                  : '제출하기',
                              style: const TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w600),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Bottom bar
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 8,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(Icons.timer,
                          color: AppColors.textSecondary, size: 20),
                      const SizedBox(width: 4),
                      Text(
                        _formatDuration(_elapsed),
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.grey[700],
                        ),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      if (_currentStep > 0)
                        TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _currentStep--;
                              _resetStepState();
                            });
                          },
                          icon: const Icon(Icons.arrow_back_ios,
                              size: 16),
                          label: const Text('이전'),
                        ),
                      if (_currentStep < totalSteps - 1)
                        TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _currentStep++;
                              _resetStepState();
                            });
                          },
                          icon: const Text('다음'),
                          label: const Icon(Icons.arrow_forward_ios,
                              size: 16),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _resetStepState() {
    _showHint = false;
    _answerController.clear();
    _oxAnswer = null;
    _capturedImage = null;
    _distanceToTarget = null;
    _checkpointArrived = false;
    _initChecklistForCurrentStep();
  }

  String _formatDuration(Duration d) {
    final h = d.inHours.toString().padLeft(2, '0');
    final m = (d.inMinutes % 60).toString().padLeft(2, '0');
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  Widget _buildStepContent() {
    switch (_currentStepData['type']) {
      case 'CHECKPOINT':
        return _buildCheckpointContent();
      case 'SNAPSHOT':
        return _buildSnapshotContent();
      case 'QUEST':
        return _buildQuestContent();
      case 'OX_QUIZ':
        return _buildOxQuizContent();
      case 'LIST':
        return _buildListContent();
      default:
        return const Center(child: Text('알 수 없는 스텝 유형'));
    }
  }

  Widget _buildCheckpointContent() {
    return Column(
      children: [
        Container(
          height: 250,
          width: double.infinity,
          decoration: BoxDecoration(
            color: AppColors.bgSurface,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.map, size: 48, color: Colors.grey),
                SizedBox(height: 8),
                Text('지도 영역', style: TextStyle(color: Colors.grey)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _checkpointArrived
                ? Colors.green[50]
                : Colors.orange[50],
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                _checkpointArrived
                    ? Icons.check_circle
                    : Icons.near_me,
                color: _checkpointArrived
                    ? Colors.green[700]
                    : Colors.orange[700],
              ),
              const SizedBox(width: 8),
              Text(
                _checkpointArrived
                    ? '도착 확인됨!'
                    : _distanceToTarget != null
                        ? '목적지까지 약 ${_distanceToTarget!.toInt()}m'
                        : '위치 확인 중...',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: _checkpointArrived
                      ? Colors.green[700]
                      : Colors.orange[700],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: OutlinedButton.icon(
            // TODO: Phase 2 — 5초 자동 GPS 폴링 구현
            onPressed: _checkpointArrived ? null : _checkGpsProximity,
            icon: const Icon(Icons.gps_fixed),
            label: Text(_checkpointArrived ? '확인 완료' : '도착 확인'),
            style: OutlinedButton.styleFrom(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _checkGpsProximity() async {
    try {
      final locationService = LocationService();
      final pos = await locationService.getCurrentPosition();
      final step = _currentStepData;

      // Parse target location from step data
      // The DB stores geography(Point), but API returns it in various forms
      final targetLat = step['target_lat'] as num?;
      final targetLng = step['target_lng'] as num?;
      final radius =
          (step['location_radius_meters'] as num?)?.toDouble() ?? 50.0;

      if (targetLat == null || targetLng == null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('이 스텝의 목표 위치가 설정되지 않았습니다')),
          );
        }
        return;
      }

      final distance = locationService.calculateDistance(
        pos.latitude,
        pos.longitude,
        targetLat.toDouble(),
        targetLng.toDouble(),
      );

      setState(() {
        _distanceToTarget = distance;
        _checkpointArrived = distance <= radius;
      });

      if (_checkpointArrived) {
        HapticFeedback.mediumImpact();
      }

      if (!_checkpointArrived && mounted) {
        HapticFeedback.vibrate();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                '아직 도착하지 않았습니다. ${distance.toInt()}m 남았습니다.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        HapticFeedback.vibrate();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('위치 확인 실패: $e')),
        );
      }
    }
  }

  Widget _buildSnapshotContent() {
    return Column(
      children: [
        Container(
          height: 250,
          width: double.infinity,
          decoration: BoxDecoration(
            color: AppColors.bgSurface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.borderDefault),
          ),
          child: _capturedImage != null
              ? ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: kIsWeb
                      ? Image.network(_capturedImage!.path, fit: BoxFit.cover)
                      : Image.network(_capturedImage!.path, fit: BoxFit.cover),
                )
              : const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.image, size: 48, color: Colors.grey),
                      SizedBox(height: 8),
                      Text('촬영된 사진이 여기에 표시됩니다',
                          style: TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: SizedBox(
                height: 48,
                child: ElevatedButton.icon(
                  onPressed: () => _pickImage(ImageSource.camera),
                  icon: const Icon(Icons.camera_alt),
                  label: const Text('카메라'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: SizedBox(
                height: 48,
                child: OutlinedButton.icon(
                  onPressed: () => _pickImage(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library),
                  label: const Text('갤러리'),
                  style: OutlinedButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _pickImage(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1080,
        imageQuality: 85,
      );
      if (picked != null) {
        setState(() => _capturedImage = picked);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('이미지 선택 실패: $e')),
        );
      }
    }
  }

  Widget _buildQuestContent() {
    final step = _currentStepData;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (step['quest_question'] != null) ...[
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.purple[50],
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              step['quest_question'],
              style:
                  const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(height: 16),
        ],
        const Text(
          '답변을 입력하세요',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _answerController,
          maxLines: 3,
          decoration: InputDecoration(
            hintText: '답변을 입력해주세요...',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildOxQuizContent() {
    return Row(
      children: [
        Expanded(
          child: AspectRatio(
            aspectRatio: 1,
            child: ElevatedButton(
              onPressed: () => setState(() => _oxAnswer = true),
              style: ElevatedButton.styleFrom(
                backgroundColor: _oxAnswer == true
                    ? Colors.blue[300]
                    : Colors.blue[100],
                foregroundColor: Colors.blue[800],
                elevation: _oxAnswer == true ? 4 : 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text('O',
                  style: TextStyle(
                      fontSize: 64, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: AspectRatio(
            aspectRatio: 1,
            child: ElevatedButton(
              onPressed: () => setState(() => _oxAnswer = false),
              style: ElevatedButton.styleFrom(
                backgroundColor: _oxAnswer == false
                    ? Colors.red[300]
                    : Colors.red[100],
                foregroundColor: Colors.red[800],
                elevation: _oxAnswer == false ? 4 : 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text('X',
                  style: TextStyle(
                      fontSize: 64, fontWeight: FontWeight.bold)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildListContent() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '체크리스트',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 12),
        ...List.generate(_checklistState.length, (index) {
          return CheckboxListTile(
            value: _checklistState[index]['checked'] as bool,
            onChanged: (value) {
              setState(() {
                _checklistState[index]['checked'] = value ?? false;
              });
            },
            title: Text(_checklistState[index]['text'] as String),
            controlAffinity: ListTileControlAffinity.leading,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          );
        }),
      ],
    );
  }

  Future<void> _handleSubmit() async {
    final step = _currentStepData;
    final stepType = step['type'] as String?;

    // Validation
    if (stepType == 'CHECKPOINT' && !_checkpointArrived) {
      HapticFeedback.vibrate();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('먼저 도착 확인을 해주세요')),
      );
      return;
    }
    if (stepType == 'SNAPSHOT' && _capturedImage == null) {
      HapticFeedback.vibrate();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('사진을 촬영해주세요')),
      );
      return;
    }
    if (stepType == 'QUEST' && _answerController.text.trim().isEmpty) {
      HapticFeedback.vibrate();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('답변을 입력해주세요')),
      );
      return;
    }
    if (stepType == 'OX_QUIZ' && _oxAnswer == null) {
      HapticFeedback.vibrate();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('O 또는 X를 선택해주세요')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final userId = ref.read(currentUserIdProvider);
      if (userId == null || _participation == null) return;

      final participationId = _participation!['id'] as String;
      final stepId = step['id'] as String;

      // Build evidence data
      final evidenceData = <String, dynamic>{
        'step_id': stepId,
        'participation_id': participationId,
        'user_id': userId,
      };

      // Type-specific evidence
      switch (stepType) {
        case 'CHECKPOINT':
          evidenceData['type'] = 'location';
          break;
        case 'SNAPSHOT':
          evidenceData['type'] = 'photo';
          if (_capturedImage != null) {
            final storageService = StorageService();
            final bytes = await _capturedImage!.readAsBytes();
            final ext = _capturedImage!.name.split('.').last;
            final url = await storageService.uploadBytes(
              bucket: 'evidence',
              path: '$participationId/$stepId/${DateTime.now().millisecondsSinceEpoch}.$ext',
              bytes: bytes,
              contentType: 'image/$ext',
            );
            evidenceData['media_url'] = url;
          }
          break;
        case 'QUEST':
          evidenceData['type'] = 'text_answer';
          evidenceData['text_content'] = _answerController.text.trim();
          break;
        case 'OX_QUIZ':
          evidenceData['type'] = 'ox_answer';
          evidenceData['boolean_answer'] = _oxAnswer;
          break;
        case 'LIST':
          evidenceData['type'] = 'checklist';
          evidenceData['checklist_state'] = _checklistState;
          break;
      }

      // Submit evidence
      final evidenceService = EvidenceService();
      await evidenceService.submitEvidence(evidenceData);
      HapticFeedback.mediumImpact();

      // Mark step completed
      setState(() {
        _stepCompleted[stepId] = true;
      });

      // Update participation progress
      final participationService =
          ref.read(participationServiceProvider);
      final nextIndex = _currentStep + 1;

      if (nextIndex >= _steps.length) {
        // Complete the clue
        HapticFeedback.heavyImpact();
        await participationService
            .completeParticipation(participationId);
        ref.invalidate(myParticipationsProvider);
        if (mounted) {
          context.go('/clue/${widget.clueId}/result');
        }
      } else {
        HapticFeedback.heavyImpact();
        await participationService.updateProgress(
            participationId, nextIndex);
        setState(() {
          _currentStep = nextIndex;
          _resetStepState();
        });
      }
    } catch (e) {
      if (mounted) {
        HapticFeedback.vibrate();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('제출 실패: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  void _showExitConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('클루 나가기'),
        content: const Text('진행 중인 클루를 나가시겠습니까? 진행 상황은 저장됩니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('계속하기'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              context.pop();
            },
            child:
                const Text('나가기', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }
}
