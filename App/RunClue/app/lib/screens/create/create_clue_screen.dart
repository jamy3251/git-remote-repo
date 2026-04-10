import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:image_picker/image_picker.dart';
import 'package:google_fonts/google_fonts.dart';
import 'dart:io';

import '../../config/theme.dart';
import '../../providers/auth_provider.dart';
import '../../services/clue_service.dart';
import '../../services/step_service.dart';
import '../../services/storage_service.dart';
import '../../widgets/common/badge_chip.dart';
import '../../widgets/common/location_picker_modal.dart';
import '../../widgets/step_editors/step_editor_fields.dart';

class CreateClueScreen extends ConsumerStatefulWidget {
  const CreateClueScreen({super.key});

  @override
  ConsumerState<CreateClueScreen> createState() => _CreateClueScreenState();
}

class _CreateClueScreenState extends ConsumerState<CreateClueScreen> {
  final _pageController = PageController();
  int _currentPage = 0;
  final int _totalPages = 5;

  // Page 1: Basic Info
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  String? _selectedCategory;
  final List<String> _categories = [
    '어드벤처',
    '퀴즈',
    '교육',
    '생활도움',
    '프로모션',
    '워크숍',
  ];

  // Page 2: Settings
  bool _isPublic = true;
  final _maxParticipantsController = TextEditingController(text: '50');
  DateTime? _startTime;
  DateTime? _endTime;
  final _timeLimitController = TextEditingController(text: '120');

  // Location
  LocationResult? _locationResult;

  // Page 3: Steps
  final List<Map<String, dynamic>> _steps = [];

  // Page 4: Rewards
  String _rewardType = 'point';
  final _rewardValueController = TextEditingController();
  final _badgeNameController = TextEditingController();

  File? _thumbnailImage;
  bool _isSubmitting = false;

  static const _categoryMap = {
    '어드벤처': 'adventure',
    '퀴즈': 'quiz',
    '교육': 'education',
    '생활도움': 'life_help',
    '프로모션': 'promotion',
    '워크숍': 'workshop',
  };

  static const _rewardTypeMap = {
    'point': 'points',
    'badge': 'badge',
    'coupon': 'coupon',
    'none': null,
  };

  @override
  void dispose() {
    _pageController.dispose();
    _titleController.dispose();
    _descriptionController.dispose();
    _maxParticipantsController.dispose();
    _timeLimitController.dispose();
    _rewardValueController.dispose();
    _badgeNameController.dispose();
    super.dispose();
  }

  void _goToPage(int page) {
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
    setState(() => _currentPage = page);
  }

  @override
  Widget build(BuildContext context) {
    final pageTitles = [
      '기본 정보',
      '설정',
      '스텝 구성',
      '보상 설정',
      '미리보기 & 제출',
    ];

    return Scaffold(
      backgroundColor: AppColors.bgBase,
      appBar: AppBar(
        backgroundColor: AppColors.bgBase,
        leading: IconButton(
          icon: const Icon(Icons.close, color: AppColors.textSecondary),
          onPressed: () => context.pop(),
        ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '클루 만들기',
              style: GoogleFonts.blackHanSans(fontSize: 18, color: AppColors.textPrimary),
            ),
            const SizedBox(width: 8),
            Text(
              '${_currentPage + 1}/$_totalPages',
              style: GoogleFonts.notoSansKr(fontSize: 13, color: AppColors.textMuted),
            ),
          ],
        ),
        centerTitle: true,
        elevation: 0,
      ),
      body: Column(
        children: [
          // 진행 인디케이터 (노란색 fill)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
            child: Row(
              children: List.generate(_totalPages, (index) {
                return Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 2),
                    height: 4,
                    decoration: BoxDecoration(
                      color: index <= _currentPage
                          ? AppColors.brandYellow
                          : AppColors.bgSurface,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                );
              }),
            ),
          ),

          // Page Content
          Expanded(
            child: PageView(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              onPageChanged: (page) {
                setState(() => _currentPage = page);
              },
              children: [
                _buildBasicInfoPage(),
                _buildSettingsPage(),
                _buildStepsPage(),
                _buildRewardPage(),
                _buildPreviewPage(),
              ],
            ),
          ),

          // 하단 네비게이션 버튼 (다크 + 노란 CTA)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: AppColors.bgBase,
              border: Border(top: BorderSide(color: AppColors.borderSubtle)),
            ),
            child: SafeArea(
              child: Row(
                children: [
                  if (_currentPage > 0)
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _goToPage(_currentPage - 1),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          minimumSize: const Size(0, 52),
                          side: const BorderSide(color: AppColors.borderDefault),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: Text('이전', style: GoogleFonts.notoSansKr(
                          fontWeight: FontWeight.w700,
                        )),
                      ),
                    ),
                  if (_currentPage > 0) const SizedBox(width: 12),
                  Expanded(
                    child: Container(
                      height: 52,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        gradient: const LinearGradient(
                          colors: [AppColors.brandYellow, AppColors.brandYellowDeep],
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.brandYellow.withValues(alpha: 0.3),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () {
                            if (_currentPage < _totalPages - 1) {
                              _goToPage(_currentPage + 1);
                            }
                          },
                          child: Center(
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _currentPage < _totalPages - 1 ? '다음 단계' : '완료',
                                  style: GoogleFonts.notoSansKr(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w900,
                                    color: Colors.black,
                                  ),
                                ),
                                if (_currentPage < _totalPages - 1) ...[
                                  const SizedBox(width: 4),
                                  const Icon(Icons.chevron_right, color: Colors.black, size: 20),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // Page 1: Basic Info
  Widget _buildBasicInfoPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title
          const Text(
            '클루 제목',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _titleController,
            decoration: InputDecoration(
              hintText: '매력적인 클루 제목을 입력하세요',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Description
          const Text(
            '설명',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _descriptionController,
            maxLines: 5,
            decoration: InputDecoration(
              hintText: '클루에 대한 설명을 작성하세요',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Category Selector
          const Text(
            '카테고리',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _categories.map((category) {
              final isSelected = _selectedCategory == category;
              return ChoiceChip(
                label: Text(category),
                selected: isSelected,
                onSelected: (selected) {
                  setState(() {
                    _selectedCategory = selected ? category : null;
                  });
                },
                selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
              );
            }).toList(),
          ),
          const SizedBox(height: 24),

          // Thumbnail Image Picker
          const Text(
            '썸네일 이미지',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          InkWell(
            onTap: () async {
              final picker = ImagePicker();
              final image = await picker.pickImage(
                source: ImageSource.gallery,
                maxWidth: 1280,
                imageQuality: 85,
              );
              if (image != null) {
                setState(() => _thumbnailImage = File(image.path));
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              height: 180,
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppColors.bgSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: AppColors.borderDefault,
                  style: BorderStyle.solid,
                ),
              ),
              child: _thumbnailImage != null
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.file(
                        _thumbnailImage!,
                        fit: BoxFit.cover,
                        width: double.infinity,
                      ),
                    )
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add_photo_alternate,
                            size: 48, color: AppColors.textMuted),
                        const SizedBox(height: 8),
                        Text(
                          '이미지를 선택하세요',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  // Page 2: Settings
  Widget _buildSettingsPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Public/Private Toggle
          SwitchListTile(
            title: const Text(
              '공개 여부',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text(_isPublic ? '누구나 참여 가능' : '초대된 사람만 참여 가능'),
            value: _isPublic,
            onChanged: (value) {
              setState(() => _isPublic = value);
            },
            contentPadding: EdgeInsets.zero,
          ),
          const Divider(),
          const SizedBox(height: 16),

          // Max Participants
          const Text(
            '최대 참여자 수',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _maxParticipantsController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              suffixText: '명',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Start Time
          const Text(
            '시작 시간',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          InkWell(
            onTap: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: DateTime.now(),
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (date != null && mounted) {
                final time = await showTimePicker(
                  context: context,
                  initialTime: TimeOfDay.now(),
                );
                if (time != null) {
                  setState(() {
                    _startTime = DateTime(
                      date.year, date.month, date.day,
                      time.hour, time.minute,
                    );
                  });
                }
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.textMuted),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(Icons.calendar_today, size: 20),
                  const SizedBox(width: 12),
                  Text(
                    _startTime != null
                        ? '${_startTime!.year}.${_startTime!.month.toString().padLeft(2, '0')}.${_startTime!.day.toString().padLeft(2, '0')} ${_startTime!.hour.toString().padLeft(2, '0')}:${_startTime!.minute.toString().padLeft(2, '0')}'
                        : '시작 시간을 선택하세요',
                    style: TextStyle(
                      color: _startTime != null ? Colors.black : Colors.grey,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // End Time
          const Text(
            '종료 시간',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          InkWell(
            onTap: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: _startTime ?? DateTime.now(),
                firstDate: _startTime ?? DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (date != null && mounted) {
                final time = await showTimePicker(
                  context: context,
                  initialTime: TimeOfDay.now(),
                );
                if (time != null) {
                  setState(() {
                    _endTime = DateTime(
                      date.year, date.month, date.day,
                      time.hour, time.minute,
                    );
                  });
                }
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.textMuted),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(Icons.calendar_today, size: 20),
                  const SizedBox(width: 12),
                  Text(
                    _endTime != null
                        ? '${_endTime!.year}.${_endTime!.month.toString().padLeft(2, '0')}.${_endTime!.day.toString().padLeft(2, '0')} ${_endTime!.hour.toString().padLeft(2, '0')}:${_endTime!.minute.toString().padLeft(2, '0')}'
                        : '종료 시간을 선택하세요',
                    style: TextStyle(
                      color: _endTime != null ? Colors.black : Colors.grey,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Time Limit
          const Text(
            '참여자 제한시간 (분)',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _timeLimitController,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              suffixText: '분',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Location Picker
          const Text(
            '위치 설정',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          InkWell(
            onTap: () async {
              final result = await LocationPickerModal.show(context);
              if (result != null) {
                setState(() => _locationResult = result);
              }
            },
            borderRadius: BorderRadius.circular(12),
            child: Container(
              height: 150,
              width: double.infinity,
              decoration: BoxDecoration(
                color: AppColors.bgSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _locationResult != null
                      ? AppColors.brandYellow.withValues(alpha: 0.4)
                      : AppColors.borderDefault,
                ),
              ),
              child: _locationResult != null
                  ? Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.location_on,
                              size: 32, color: AppColors.brandYellow),
                          const SizedBox(height: 8),
                          Text(
                            _locationResult!.address,
                            style: const TextStyle(
                                color: AppColors.textPrimary, fontSize: 14),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${_locationResult!.latitude.toStringAsFixed(4)}, ${_locationResult!.longitude.toStringAsFixed(4)}',
                            style: const TextStyle(
                                color: AppColors.textMuted, fontSize: 12),
                          ),
                        ],
                      ),
                    )
                  : const Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.add_location_alt,
                            size: 40, color: Colors.grey),
                        SizedBox(height: 8),
                        Text(
                          '탭하여 위치를 설정하세요',
                          style: TextStyle(color: Colors.grey),
                        ),
                        Text(
                          '(중심점 + 반경 설정)',
                          style: TextStyle(color: Colors.grey, fontSize: 12),
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  // Page 3: Steps
  Widget _buildStepsPage() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Add Step Button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              onPressed: () {
                _showAddStepDialog();
              },
              icon: const Icon(Icons.add),
              label: const Text('스텝 추가'),
              style: OutlinedButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Steps List
          Expanded(
            child: _steps.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.playlist_add,
                            size: 64, color: Colors.grey[300]),
                        const SizedBox(height: 12),
                        Text(
                          '스텝을 추가해주세요',
                          style: TextStyle(
                            fontSize: 16,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '스텝은 참여자가 수행할 미션 단계입니다',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  )
                : ReorderableListView.builder(
                    itemCount: _steps.length,
                    onReorder: (oldIndex, newIndex) {
                      setState(() {
                        if (newIndex > oldIndex) newIndex--;
                        final item = _steps.removeAt(oldIndex);
                        _steps.insert(newIndex, item);
                      });
                    },
                    itemBuilder: (context, index) {
                      final step = _steps[index];
                      return Card(
                        key: ValueKey('step_$index'),
                        elevation: 0,
                        color: AppColors.bgSurface,
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor:
                                Theme.of(context).primaryColor.withOpacity(0.1),
                            child: Text(
                              '${index + 1}',
                              style: TextStyle(
                                color: Theme.of(context).primaryColor,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          title: Text(
                            step['title'] ?? '스텝 ${index + 1}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w500),
                          ),
                          subtitle: Text(step['type'] ?? ''),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              IconButton(
                                icon: const Icon(Icons.edit, size: 20),
                                onPressed: () {
                                  _showEditStepDialog(index);
                                },
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete,
                                    size: 20, color: Colors.red),
                                onPressed: () {
                                  setState(() => _steps.removeAt(index));
                                },
                              ),
                              const Icon(Icons.drag_handle),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _submitClue({required String status}) async {
    final userId = ref.read(currentUserIdProvider);
    if (userId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('로그인이 필요합니다')),
      );
      return;
    }

    if (_titleController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('클루 제목을 입력해주세요')),
      );
      return;
    }

    if (status == 'pending_approval' && _steps.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('스텝을 최소 1개 이상 추가해주세요')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final clueService = ClueService();
      final stepService = StepService();

      final rewardType = _rewardTypeMap[_rewardType];
      final rewardValue = _rewardValueController.text.trim().isNotEmpty
          ? int.tryParse(_rewardValueController.text.trim())
          : null;

      final clueData = <String, dynamic>{
        'creator_id': userId,
        'title': _titleController.text.trim(),
        'description': _descriptionController.text.trim(),
        'category': _categoryMap[_selectedCategory],
        'status': status,
        'is_public': _isPublic,
        'max_participants':
            int.tryParse(_maxParticipantsController.text.trim()) ?? 50,
        'time_limit_minutes':
            int.tryParse(_timeLimitController.text.trim()) ?? 120,
        if (rewardType != null) 'reward_type': rewardType,
        if (rewardValue != null) 'reward_value': rewardValue,
        if (_startTime != null) 'start_time': _startTime!.toIso8601String(),
        if (_endTime != null) 'end_time': _endTime!.toIso8601String(),
        if (_locationResult != null) ...{
          'center_latitude': _locationResult!.latitude,
          'center_longitude': _locationResult!.longitude,
          'center_address': _locationResult!.address,
        },
      };

      final createdClue = await clueService.createClue(clueData);
      final clueId = createdClue['id'] as String;

      // Upload thumbnail if selected
      String? thumbnailUrl;
      if (_thumbnailImage != null) {
        final storageService = StorageService();
        thumbnailUrl = await storageService.uploadClueImage(
          _thumbnailImage!,
          clueId,
        );
        await clueService.updateClue(clueId, {'thumbnail_url': thumbnailUrl});
      }

      // Create steps with type-specific fields
      for (var i = 0; i < _steps.length; i++) {
        final step = Map<String, dynamic>.from(_steps[i]);
        final stepData = <String, dynamic>{
          'clue_id': clueId,
          'order_index': i,
          'type': step['type'],
          'title': step['title'],
          'instruction': step['instruction'],
        };

        // Add type-specific fields
        switch (step['type']) {
          case 'CHECKPOINT':
            if (step['target_latitude'] != null) {
              stepData['target_location'] =
                  'POINT(${step['target_longitude']} ${step['target_latitude']})';
              stepData['location_radius_meters'] =
                  step['location_radius_meters'] ?? 50;
            }
            break;
          case 'QUEST':
            stepData['quest_question'] = step['quest_question'];
            stepData['quest_answer'] = step['quest_answer'];
            stepData['quest_answer_type'] = step['quest_answer_type'] ?? 'exact';
            stepData['validation_type'] = 'auto';
            break;
          case 'OX_QUIZ':
            stepData['quiz_correct_answer'] = step['quiz_correct_answer'];
            stepData['quiz_explanation'] = step['quiz_explanation'];
            stepData['quiz_time_limit_seconds'] =
                step['quiz_time_limit_seconds'] ?? 30;
            stepData['validation_type'] = 'auto';
            break;
          case 'LIST':
            stepData['checklist_items'] = step['checklist_items'];
            stepData['validation_type'] = 'auto';
            break;
          case 'SNAPSHOT':
            stepData['validation_type'] = 'manual';
            break;
        }

        await stepService.createStep(stepData);
      }

      if (!mounted) return;

      final message = status == 'draft' ? '임시저장되었습니다' : '승인 요청이 완료되었습니다';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
      context.go('/explore');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('오류가 발생했습니다: $e')),
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _showAddStepDialog() {
    String? selectedType;
    final stepTitleController = TextEditingController();
    final stepInstructionController = TextEditingController();
    final questQuestionController = TextEditingController();
    final questAnswerController = TextEditingController();
    final quizExplanationController = TextEditingController();
    final typeSpecificData = <String, dynamic>{};

    final stepTypes = [
      {'value': 'CHECKPOINT', 'label': '체크포인트', 'icon': Icons.location_on},
      {'value': 'SNAPSHOT', 'label': '스냅샷', 'icon': Icons.camera_alt},
      {'value': 'QUEST', 'label': '퀘스트', 'icon': Icons.quiz},
      {'value': 'OX_QUIZ', 'label': 'OX 퀴즈', 'icon': Icons.check_circle},
      {'value': 'LIST', 'label': '리스트', 'icon': Icons.checklist},
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            Widget? typeSpecificFields;
            if (selectedType == 'CHECKPOINT') {
              typeSpecificFields = CheckpointFields(data: typeSpecificData);
            } else if (selectedType == 'QUEST') {
              typeSpecificFields = QuestFields(
                data: typeSpecificData,
                questionController: questQuestionController,
                answerController: questAnswerController,
              );
            } else if (selectedType == 'OX_QUIZ') {
              typeSpecificFields = OxQuizFields(
                data: typeSpecificData,
                explanationController: quizExplanationController,
              );
            } else if (selectedType == 'LIST') {
              typeSpecificFields = ListFields(data: typeSpecificData);
            }

            return DraggableScrollableSheet(
              initialChildSize: selectedType != null ? 0.85 : 0.55,
              minChildSize: 0.4,
              maxChildSize: 0.95,
              expand: false,
              builder: (context, scrollController) {
                return SingleChildScrollView(
                  controller: scrollController,
                  padding: EdgeInsets.fromLTRB(
                    24, 24, 24,
                    MediaQuery.of(context).viewInsets.bottom + 24,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '스텝 추가',
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 20),

                      const Text('스텝 유형',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: stepTypes.map((type) {
                          final isSelected = selectedType == type['value'];
                          return ChoiceChip(
                            avatar: Icon(type['icon'] as IconData, size: 18),
                            label: Text(type['label'] as String),
                            selected: isSelected,
                            onSelected: (selected) {
                              setModalState(() {
                                selectedType =
                                    selected ? type['value'] as String : null;
                                typeSpecificData.clear();
                              });
                            },
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 16),

                      TextField(
                        controller: stepTitleController,
                        decoration: InputDecoration(
                          labelText: '스텝 제목',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),

                      TextField(
                        controller: stepInstructionController,
                        maxLines: 3,
                        decoration: InputDecoration(
                          labelText: '설명/지시사항',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),

                      if (typeSpecificFields != null) ...[
                        const SizedBox(height: 20),
                        const Divider(),
                        const SizedBox(height: 12),
                        typeSpecificFields,
                      ],

                      const SizedBox(height: 20),

                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton(
                          onPressed: () {
                            if (selectedType != null &&
                                stepTitleController.text.isNotEmpty) {
                              setState(() {
                                _steps.add({
                                  'type': selectedType,
                                  'title': stepTitleController.text,
                                  'instruction': stepInstructionController.text,
                                  ...typeSpecificData,
                                });
                              });
                              Navigator.pop(context);
                            }
                          },
                          style: ElevatedButton.styleFrom(
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text('추가'),
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  void _showEditStepDialog(int index) {
    final step = Map<String, dynamic>.from(_steps[index]);
    final titleController = TextEditingController(text: step['title'] ?? '');
    final instructionController =
        TextEditingController(text: step['instruction'] ?? '');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
            24, 24, 24,
            MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '스텝 편집 (${step['type']})',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: titleController,
                decoration: InputDecoration(
                  labelText: '스텝 제목',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: instructionController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: '설명/지시사항',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _steps[index] = {
                        ...step,
                        'title': titleController.text,
                        'instruction': instructionController.text,
                      };
                    });
                    Navigator.pop(context);
                  },
                  style: ElevatedButton.styleFrom(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text('저장'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // Page 4: Reward
  Widget _buildRewardPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '보상 유형',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),

          // Reward Type Selector
          ...[
            {'value': 'point', 'label': '포인트', 'icon': Icons.star},
            {'value': 'badge', 'label': '배지', 'icon': Icons.military_tech},
            {'value': 'coupon', 'label': '쿠폰', 'icon': Icons.confirmation_number},
            {'value': 'none', 'label': '없음', 'icon': Icons.block},
          ].map((type) {
            return RadioListTile<String>(
              value: type['value'] as String,
              groupValue: _rewardType,
              onChanged: (value) {
                setState(() => _rewardType = value!);
              },
              title: Row(
                children: [
                  Icon(type['icon'] as IconData, size: 20),
                  const SizedBox(width: 8),
                  Text(type['label'] as String),
                ],
              ),
              contentPadding: EdgeInsets.zero,
            );
          }),
          const SizedBox(height: 16),

          // Reward Value
          if (_rewardType != 'none') ...[
            const Text(
              '보상 값',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _rewardValueController,
              keyboardType: _rewardType == 'point'
                  ? TextInputType.number
                  : TextInputType.text,
              decoration: InputDecoration(
                hintText: _rewardType == 'point'
                    ? '포인트 수를 입력하세요'
                    : '보상 내용을 입력하세요',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Badge Name (if badge type)
          if (_rewardType == 'badge') ...[
            const Text(
              '배지 이름',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _badgeNameController,
              decoration: InputDecoration(
                hintText: '배지 이름을 입력하세요',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // Page 5: Preview & Submit
  Widget _buildPreviewPage() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Preview Card
          Card(
            elevation: 2,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Thumbnail Placeholder
                  Container(
                    height: 150,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: AppColors.bgSurface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Center(
                      child: Icon(Icons.image, size: 48, color: Colors.grey),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Category Badge
                  if (_selectedCategory != null)
                    BadgeChip(
                      label: _selectedCategory!,
                      color: Colors.orange,
                    ),
                  const SizedBox(height: 8),

                  // Title
                  Text(
                    _titleController.text.isNotEmpty
                        ? _titleController.text
                        : '(제목 없음)',
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Description
                  Text(
                    _descriptionController.text.isNotEmpty
                        ? _descriptionController.text
                        : '(설명 없음)',
                    style: TextStyle(
                      fontSize: 14,
                      color: AppColors.textSecondary,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 16),

                  const Divider(),
                  const SizedBox(height: 12),

                  // Settings Summary
                  _PreviewInfoRow(
                    label: '공개 여부',
                    value: _isPublic ? '공개' : '비공개',
                  ),
                  _PreviewInfoRow(
                    label: '최대 참여자',
                    value: '${_maxParticipantsController.text}명',
                  ),
                  _PreviewInfoRow(
                    label: '제한시간',
                    value: '${_timeLimitController.text}분',
                  ),
                  _PreviewInfoRow(
                    label: '스텝 수',
                    value: '${_steps.length}개',
                  ),
                  _PreviewInfoRow(
                    label: '보상',
                    value: _rewardType == 'none'
                        ? '없음'
                        : '$_rewardType: ${_rewardValueController.text}',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Warning for prize/broadcast type
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.orange[50],
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.orange[200]!),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: Colors.orange[700]),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '상품/방송형 클루는 관리자 승인이 필요합니다',
                    style: TextStyle(
                      color: Colors.orange[800],
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Draft Save Button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton(
              onPressed: _isSubmitting
                  ? null
                  : () => _submitClue(status: 'draft'),
              style: OutlinedButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _isSubmitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('임시저장'),
            ),
          ),
          const SizedBox(height: 12),

          // Submit Button
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: _isSubmitting
                  ? null
                  : () {
                      showDialog(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('승인 요청'),
                          content: const Text('클루를 승인 요청하시겠습니까?'),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(ctx),
                              child: const Text('취소'),
                            ),
                            ElevatedButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                _submitClue(status: 'pending_approval');
                              },
                              child: const Text('요청'),
                            ),
                          ],
                        ),
                      );
                    },
              style: ElevatedButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: const Text(
                '승인 요청',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewInfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _PreviewInfoRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
          ),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
          ),
        ],
      ),
    );
  }
}
