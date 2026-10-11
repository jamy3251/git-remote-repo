import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:mytrainer/data/exercises.dart';
import 'package:mytrainer/data/local_repository.dart';
import 'package:mytrainer/data/workout.dart';
import 'package:mytrainer/diet/body_profile.dart';
import 'package:mytrainer/diet/diet_repository.dart';
import 'package:mytrainer/diet/diet_state.dart';
import 'package:mytrainer/diet/food.dart';
import 'package:mytrainer/diet/food_db.dart';
import 'package:mytrainer/diet/food_photo.dart';
import 'package:mytrainer/diet/meal.dart';
import 'package:mytrainer/diet/meal_draft.dart';
import 'package:mytrainer/diet/nutrients.dart';
import 'package:mytrainer/machines/machine_repository.dart';
import 'package:mytrainer/machines/machines_state.dart';
import 'package:mytrainer/routines/routine_repository.dart';
import 'package:mytrainer/routines/routines_state.dart';
import 'package:mytrainer/services/geofence_service.dart';
import 'package:mytrainer/state/attendance.dart';
import 'package:mytrainer/ui/diet/body_profile_screen.dart';
import 'package:mytrainer/ui/diet/diet_screen.dart';
import 'package:mytrainer/ui/diet/food_search_screen.dart';
import 'package:mytrainer/ui/diet/photo_meal_screen.dart';
import 'package:mytrainer/ui/home/recommend_card.dart';
import 'package:mytrainer/ui/log/log_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _emptyDir = Directory.systemTemp.createTempSync('mytrainer_test');
final _now = DateTime(2026, 10, 12, 18, 30); // 저녁

const _chicken = Food(code: 'D1', name: '닭가슴살', per100: Nutrients(kcal: 109, carb: 0, protein: 23, fat: 1.2));
const _rice = Food(
    code: 'D2', name: '현미밥', per100: Nutrients(kcal: 150, carb: 32, protein: 3, fat: 1), servingSize: 210);

class _FakePhotos implements MealPhotoSource {
  @override
  Future<List<int>?> take({required bool camera}) async => [1, 2, 3];
}

class _FakeAnalyzer implements FoodPhotoAnalyzer {
  _FakeAnalyzer(this.result);
  final List<PhotoFood> result;

  @override
  bool get available => true;

  @override
  Future<List<PhotoFood>> analyze(List<int> jpeg) async => result;
}

void main() {
  late SharedPreferences prefs;
  late LocalDietRepository diet;
  late LocalAttendanceRepository repo;
  late LocalRoutineRepository routines;

  setUp(() async {
    await initializeDateFormatting('ko_KR');
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    diet = LocalDietRepository(prefs);
    repo = LocalAttendanceRepository(prefs);
    routines = LocalRoutineRepository(prefs);
  });

  Future<void> pump(WidgetTester t, String path, {FoodPhotoAnalyzer? analyzer, Widget? home}) async {
    t.view.physicalSize = const Size(1080, 4000);
    addTearDown(t.view.resetPhysicalSize);
    final router = GoRouter(initialLocation: '/', routes: [
      GoRoute(path: '/', builder: (_, __) => home ?? const Scaffold(body: Text('home'))),
      GoRoute(path: '/log', builder: (_, __) => const LogScreen()),
      GoRoute(path: '/diet', builder: (_, __) => const DietScreen()),
      GoRoute(path: '/diet/profile', builder: (_, __) => const BodyProfileScreen()),
      GoRoute(path: '/diet/search', builder: (_, __) => const FoodSearchScreen()),
      GoRoute(path: '/diet/manual', builder: (_, __) => const ManualMealScreen()),
      GoRoute(path: '/diet/photo', builder: (_, __) => const PhotoMealScreen()),
    ]);
    await t.pumpWidget(ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        repositoryProvider.overrideWithValue(repo),
        geofenceServiceProvider.overrideWithValue(GeofenceService(baseDir: () async => _emptyDir)),
        machineRepositoryProvider.overrideWithValue(LocalMachineRepository(prefs)),
        routineRepositoryProvider.overrideWithValue(routines),
        dietRepositoryProvider.overrideWithValue(diet),
        clockProvider.overrideWithValue(() => _now),
        foodIndexProvider.overrideWith((_) async => FoodIndex([_chicken.toTsv(), _rice.toTsv()])),
        mealPhotoSourceProvider.overrideWithValue(_FakePhotos()),
        if (analyzer != null) foodPhotoAnalyzerProvider.overrideWithValue(analyzer),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await t.pumpAndSettle();
    if (path != '/') {
      router.push(path);
      await t.pumpAndSettle();
    }
  }

  Future<List<MealEntry>> saved() => diet.meals(since: DateTime(2000));

  testWidgets('몸 정보를 넣으면 하루 목표가 계산되고 근거를 볼 수 있다', (t) async {
    await pump(t, '/diet');
    expect(find.text('하루 목표가 아직 없어요'), findsOneWidget);
    await t.tap(find.text('몸 정보 넣기'));
    await t.pumpAndSettle();

    await t.enterText(find.widgetWithText(TextField, '출생연도'), '2030');
    await t.enterText(find.widgetWithText(TextField, '키'), '180');
    await t.enterText(find.widgetWithText(TextField, '몸무게'), '80');
    await t.tap(find.text('저장'));
    await t.pumpAndSettle();
    expect(find.text('출생연도를 확인해 주세요(만 14~90세)'), findsOneWidget);

    await t.enterText(find.widgetWithText(TextField, '출생연도'), '1996');
    await t.tap(find.text('저장'));
    await t.pumpAndSettle();

    expect(find.text('오늘 · 유지 목표 2759kcal'), findsOneWidget);
    expect(find.text('2759kcal 남았어요'), findsOneWidget);
    expect((await diet.profile())!.heightCm, 180);
    await t.tap(find.text('어떻게 계산했나요?'));
    await t.pumpAndSettle();
    expect(find.text('기초대사량 1780kcal (키 180cm, 80.0kg, 30세)'), findsOneWidget);
  });

  testWidgets('검색 → 양 정하기 → 저녁으로 기록, 다음엔 최근 음식에 뜬다', (t) async {
    await pump(t, '/diet');
    await t.tap(find.text('검색'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField), '현미');
    await t.pumpAndSettle();
    await t.tap(find.text('현미밥'));
    await t.pumpAndSettle();

    // 1회 제공량 210g 이 기본값, +10 하면 220g.
    expect(find.text('315kcal · 탄 67g 단 6g 지 2g'), findsOneWidget);
    await t.tap(find.byIcon(Icons.add));
    await t.pumpAndSettle();
    expect(find.text('330kcal · 탄 70g 단 7g 지 2g'), findsOneWidget);
    await t.tap(find.text('기록'));
    await t.pumpAndSettle();

    final m = (await saved()).single;
    expect((m.name, m.amount, m.meal, m.source, m.foodCode), ('현미밥', 220.0, MealType.dinner, MealSource.db, 'D2'));
    expect(find.text('현미밥 220g'), findsOneWidget);

    await t.tap(find.text('검색'));
    await t.pumpAndSettle();
    expect(find.text('최근 먹은 음식'), findsOneWidget);
    expect(find.widgetWithText(ListTile, '현미밥'), findsOneWidget);
  });

  testWidgets('직접 입력: 이름·열량이 없으면 막고, 있으면 저장', (t) async {
    await pump(t, '/diet/manual');
    await t.tap(find.text('기록'));
    await t.pumpAndSettle();
    expect(find.text('음식 이름과 열량은 꼭 넣어 주세요'), findsOneWidget);

    await t.enterText(find.widgetWithText(TextField, '음식 이름'), '프로틴 바');
    await t.enterText(find.widgetWithText(TextField, '열량'), '200');
    await t.enterText(find.widgetWithText(TextField, '단백질'), '20');
    await t.tap(find.text('간식'));
    await t.tap(find.text('기록'));
    await t.pumpAndSettle();
    final m = (await saved()).single;
    expect((m.name, m.amount, m.meal, m.nutrients.kcal, m.nutrients.protein, m.source),
        ('프로틴 바', 0.0, MealType.snack, 200.0, 20.0, MealSource.manual));
  });

  testWidgets('사진: DB 에 있는 이름은 DB 값, 없는 것은 AI 추정, 뺀 줄은 저장 안 함', (t) async {
    final ai = _FakeAnalyzer(const [
      PhotoFood(name: '닭 가슴살', grams: 150, nutrients: Nutrients(kcal: 999, carb: 9, protein: 9, fat: 9), confidence: 0.9),
      PhotoFood(name: '깍두기', grams: 40, nutrients: Nutrients(kcal: 12, carb: 2.4, protein: 0.4, fat: 0.1), confidence: 0.7),
      PhotoFood(name: '콜라', grams: 250, nutrients: Nutrients(kcal: 105, carb: 27, protein: 0, fat: 0), confidence: 0.6),
    ]);
    await pump(t, '/diet/photo', analyzer: ai);
    await t.tap(find.text('찍기'));
    await t.pumpAndSettle();

    expect(find.text('DB'), findsOneWidget);
    expect(find.text('AI 추정'), findsNWidgets(2));
    // DB 값: 150g × 109/100 = 163.5 → AI 의 999 는 버린다.
    expect(find.text('164kcal · 탄 0g 단 35g 지 2g'), findsOneWidget);

    // 깍두기 40g → 50g (AI 값을 비율로), 콜라는 뺀다.
    await t.tap(find.byIcon(Icons.add).at(1));
    await t.tap(find.byIcon(Icons.close).at(2));
    await t.pumpAndSettle();
    await t.tap(find.textContaining('2개 기록'));
    await t.pumpAndSettle();

    final ms = (await saved())..sort((a, b) => a.name.compareTo(b.name));
    expect(ms.map((m) => (m.name, m.amount, m.source)).toList(), [
      ('깍두기', 50.0, MealSource.photoAi),
      ('닭가슴살', 150.0, MealSource.photoDb),
    ]);
    expect(ms.first.nutrients.kcal, closeTo(15, 0.001));
    expect(ms.last.foodCode, 'D1');
  });

  testWidgets('사진 기록은 서버 연결이 없으면 막힌다', (t) async {
    await pump(t, '/diet');
    final button = find.ancestor(of: find.text('사진'), matching: find.byWidgetPredicate((w) => w is FilledButton));
    expect(t.widget<FilledButton>(button).onPressed, isNull);
  });

  testWidgets('추천 끼니: DB 식재료로 저녁을 짜고 "먹었어요"로 그대로 기록', (t) async {
    await diet.saveProfile(const BodyProfile(
        sex: Sex.male, birthYear: 1996, heightCm: 180, weightKg: 80, activity: Activity.moderate, goal: Goal.maintain));
    await pump(t, '/diet');
    expect(find.text('저녁 추천'), findsOneWidget);
    expect(find.textContaining('닭가슴살'), findsWidgets);
    expect(find.textContaining('남은 끼니 1번'), findsOneWidget);

    await t.tap(find.text('먹었어요').first);
    await t.pumpAndSettle();
    final ms = await saved();
    expect(ms.map((m) => m.name).toSet(), {'닭가슴살', '현미밥'});
    expect(ms.every((m) => m.source == MealSource.recommended && m.meal == MealType.dinner), isTrue);
  });

  testWidgets('추천 운동 → 오늘 루틴, 기록 화면은 지난 세션 무게 대신 추천 무게', (t) async {
    // 지난주 등 운동: 바벨 로우 60kg 3×12 → 62.5kg 추천. 하체·가슴은 이틀 전에 채움.
    var n = 0;
    WorkoutSet s(int daysAgo, String ex, double kg, int reps) => WorkoutSet(
        id: 'w${n++}', at: DateTime(2026, 10, 12 - daysAgo, 19), exerciseId: ex, variant: Variant.barbell, weightKg: kg, reps: reps);
    for (final set in [
      for (var k = 0; k < 3; k++) s(5, 'barbell_row', 60, 12),
      for (var k = 0; k < 10; k++) s(2, 'squat', 100, 5),
      for (var k = 0; k < 10; k++) s(2, 'bench_press', 80, 5),
    ]) {
      await repo.saveSet(set);
    }
    await pump(t, '/', home: const Scaffold(body: SingleChildScrollView(child: RecommendCard())));
    expect(find.text('등 · 어깨'), findsOneWidget);
    expect(find.text('62.5kg  3×8~12'), findsOneWidget);

    await t.tap(find.text('오늘 루틴으로 기록'));
    await t.pumpAndSettle();
    final r = (await routines.routines()).single;
    expect((r.recommended, r.name), (true, '추천 · 등·어깨'));
    expect(prefs.getString('mytrainer.routine.active'), r.id);

    await t.tap(find.text('바벨 로우 0/3'));
    await t.pumpAndSettle();
    expect(find.text('62.5 kg'), findsOneWidget);
  });
}
