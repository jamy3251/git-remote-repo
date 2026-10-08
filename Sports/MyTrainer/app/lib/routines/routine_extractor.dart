import 'dart:io';

import 'package:firebase_ai/firebase_ai.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'extract_spec.dart';

/// 루틴을 뽑을 영상: 유튜브 링크 또는 폰의 영상 파일.
sealed class VideoInput {
  const VideoInput();
}

class YoutubeInput extends VideoInput {
  const YoutubeInput(this.url);
  final String url;
}

class FileInput extends VideoInput {
  const FileInput(this.path, {this.mimeType = 'video/mp4'});
  final String path;
  final String mimeType;
}

abstract class RoutineExtractor {
  bool get available;

  Future<ExtractedRoutine> extract(VideoInput input);
}

/// 유튜브 주소 꼴인지(공개·일부 공개 영상만 된다). shorts·youtu.be 포함.
bool isYoutubeUrl(String s) =>
    RegExp(r'^(https?://)?(www\.|m\.)?(youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[\w-]{6,}').hasMatch(s.trim());

/// 영상 파일은 요청 하나에 인라인으로 20MB 까지(Firebase AI Logic 제한).
const maxInlineVideoBytes = 20 * 1024 * 1024;

class UnavailableExtractor implements RoutineExtractor {
  @override
  bool get available => false;

  @override
  Future<ExtractedRoutine> extract(VideoInput input) =>
      throw const ExtractError('영상 루틴 가져오기는 서버에 연결된 상태에서만 돼요');
}

/// Firebase AI Logic(Gemini Developer API 백엔드). 키는 앱에 넣지 않고 Firebase 가 대신 붙이며,
/// App Check 로 이 앱에서 온 요청만 받는다(설계 D10).
class GeminiRoutineExtractor implements RoutineExtractor {
  GeminiRoutineExtractor()
      : _model = FirebaseAI.googleAI(appCheck: FirebaseAppCheck.instance, auth: FirebaseAuth.instance)
            .generativeModel(
          model: extractModel,
          generationConfig: GenerationConfig(
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: buildExtractSchema(),
          ),
        );

  final GenerativeModel _model;

  @override
  bool get available => true;

  @override
  Future<ExtractedRoutine> extract(VideoInput input) async {
    final Part video;
    switch (input) {
      case YoutubeInput(:final url):
        if (!isYoutubeUrl(url)) throw const ExtractError('유튜브 영상 주소가 아니에요');
        // 유튜브 링크 MIME 은 실제 호출로 확인할 것(설계: 구현 첫날 확인 항목).
        video = FileData('video/mp4', url.trim());
      case FileInput(:final path, :final mimeType):
        final f = File(path);
        if (await f.length() > maxInlineVideoBytes) {
          throw const ExtractError('영상이 20MB 를 넘어요. 짧게 잘라 오거나 유튜브 링크로 넣어 주세요');
        }
        video = InlineDataPart(mimeType, await f.readAsBytes());
    }
    final GenerateContentResponse res;
    try {
      res = await _model.generateContent([
        Content.multi([video, TextPart(extractPrompt)]),
      ]).timeout(const Duration(minutes: 2));
    } on FirebaseAIException catch (e) {
      throw ExtractError('AI 요청이 실패했어요: ${e.message}');
    } on SocketException {
      throw const ExtractError('인터넷에 연결된 상태에서 다시 시도해 주세요');
    }
    return parseExtraction(res.text);
  }
}

/// [extractSchema] 와 같은 것을 firebase_ai 형식으로(테스트가 둘이 같은지 본다).
Schema buildExtractSchema() {
  Schema nInt() => Schema.integer(nullable: true);
  return Schema.object(properties: {
    'isRoutine': Schema.boolean(),
    'title': Schema.string(nullable: true),
    'exercises': Schema.array(
      items: Schema.object(properties: {
        'name': Schema.string(),
        'nameEnglish': Schema.string(nullable: true),
        'equipment': Schema.enumString(
            enumValues: ['barbell', 'dumbbell', 'smith', 'cable', 'machine', 'bodyweight', 'unknown']),
        'sets': nInt(),
        'repsMin': nInt(),
        'repsMax': nInt(),
        'restSeconds': nInt(),
        'weightKg': Schema.number(nullable: true),
        'note': Schema.string(nullable: true),
      }),
    ),
  });
}
