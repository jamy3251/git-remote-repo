package kr.ac.seoil.motionaffect;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;

/**
 * adb 명령으로 조작한다.
 *   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd selftest
 *   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd start --ei hz 16   (hz=0: 센서 없이 wakelock만)
 *   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd start --es plan 0,2,8,16,32,0 --ei seg_min 25  (배터리 실험)
 *   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd stop
 *   am start -n kr.ac.seoil.motionaffect/.MainActivity --es cmd viewing --ei n 12   (영상 시청 실험, 화면 버튼과 같음)
 * 결과 파일: /sdcard/Android/data/kr.ac.seoil.motionaffect/files/
 * 2026-10-25 화면 다듬기(Ui.java + 디자인 리뷰 반영): 상태 카드, 기록 토글, 기분 지도 버튼, 권한 목록(허용 여부). 기능은 그대로.
 */
public class MainActivity extends Activity {
    static final String TAG = "MotionAffect";
    private TextView view;
    private LinearLayout status, perm;
    private TextView toggle;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackgroundColor(Ui.BG);
        int pad = Ui.dp(this, 20);
        col.setPadding(pad, Ui.dp(this, 24), pad, Ui.dp(this, 40));

        col.addView(Ui.text(this, "온디바이스 정서 추정", 12, Ui.MUTED, false));
        col.addView(Ui.title(this, "MotionAffect"), Ui.block(this, 6));
        col.addView(Ui.text(this, "움직임으로 기분을 읽고, 폰 안에서만 배웁니다", 14, Ui.MUTED, false), Ui.block(this, 6));
        TextView noNet = Ui.pill(this, "인터넷 권한 없음 · 외부 전송 없음", Ui.MUTED, Ui.CHIP);
        LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        plp.topMargin = Ui.dp(this, 10);
        col.addView(noNet, plp);

        status = Ui.card(this);
        col.addView(status, Ui.block(this, 20));

        LinearLayout actions = new LinearLayout(this);
        toggle = Ui.button(this, "기록 시작", true);
        toggle.setOnClickListener(v -> {
            boolean running = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getBoolean(AskAlarmReceiver.KEY_RUNNING, false);
            if (running) {
                stopService(new Intent(this, LifeLogService.class));
                show("일상 기록 중지");
            } else {
                startForegroundService(new Intent(this, LifeLogService.class));
                show("일상 기록 시작");
            }
            status.postDelayed(this::renderStatus, 900);
        });
        TextView grid = Ui.button(this, "지금 기분 남기기", false);
        grid.setOnClickListener(v -> startActivity(new Intent(this, AffectGridActivity.class)
                .putExtra(AffectGridActivity.EXTRA_SRC, "main")));
        actions.addView(toggle, Ui.pair(this, true));
        actions.addView(grid, Ui.pair(this, false));
        col.addView(actions, Ui.block(this, 16));

        perm = Ui.card(this);
        col.addView(perm, Ui.block(this, 16));

        TextView viewing = Ui.text(this, "영상 시청 실험(보조) 열기", 13, Ui.MUTED, false);
        viewing.setGravity(Gravity.CENTER);
        viewing.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 4));
        viewing.setOnClickListener(v -> startActivity(new Intent(this, ViewingActivity.class)));
        col.addView(viewing, Ui.block(this, 20));

        view = Ui.text(this, "", 12, Ui.MUTED, false);
        view.setVisibility(View.GONE);
        col.addView(view, Ui.block(this, 6));

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(Ui.BG);
        sv.addView(col);
        setContentView(sv);
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);
        sv.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        renderStatus();
        renderPerms();
        handle(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (status != null) { renderStatus(); renderPerms(); }
        overlay(false);
    }

    @Override
    protected void onPause() {
        super.onPause();
        overlay(true);
    }

    /** 앱 자기 화면이 앞에 있을 때는 서비스의 떠 있는 버튼을 숨긴다(서비스가 없으면 무시됨). */
    private void overlay(boolean show) {
        sendBroadcast(new Intent(LifeLogService.ACTION_OVERLAY).setPackage(getPackageName()).putExtra("show", show));
    }

    /** 상태 카드: 기록 상태 알약, 최근 추정(안쪽 상자·막대), 교사·학생 상태. 값은 LifeLogService가 prefs에 남긴 것. */
    private void renderStatus() {
        status.removeAllViews();
        android.content.SharedPreferences pr = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE);
        boolean running = pr.getBoolean(AskAlarmReceiver.KEY_RUNNING, false);
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.addView(Ui.text(this, "일상 기록", 15, Ui.INK, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        head.addView(running ? Ui.pill(this, "기록 중", Ui.OK, Ui.OK_SOFT) : Ui.pill(this, "중지됨", Ui.MUTED, Ui.CHIP));
        status.addView(head);

        LinearLayout inner = Ui.inner(this);
        long at = pr.getLong("ui_at", 0);
        if (at > 0 && running) {
            int min = pr.getInt("ui_min", 0);
            boolean stu = pr.getBoolean("ui_student", false);
            inner.addView(Ui.text(this, String.format(Locale.US, "최근 %d분의 움직임으로 본 지금%s", min, stu ? " · 학생 모델" : ""), 13, Ui.MUTED, false));
            inner.addView(Ui.bar(this, "흥분", pr.getFloat("ui_pa", Float.NaN), Ui.PRIMARY), Ui.block(this, 8));
            inner.addView(Ui.bar(this, "유쾌", pr.getFloat("ui_pv", Float.NaN), Ui.PRIMARY), Ui.block(this, 8));
            inner.addView(Ui.text(this, java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(new java.util.Date(at)) + " 갱신", 12, Ui.MUTED, false), Ui.block(this, 6));
        } else {
            // 충전 중(USB 포함)이면 비접촉 보류 규칙으로 추정을 쉬므로 그 사실을 보여 준다.
            android.content.Intent bat = registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            int plugged = bat == null ? 0 : bat.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0);
            String msg = !running ? "기록을 시작하면 최근 30분의 추정이 여기에 보입니다"
                    : plugged != 0 ? "충전 중이라 추정을 쉬고 기록만 합니다 · 폰을 들면 5분 뒤 표시"
                    : "추정 준비 중 · 움직임이 5분 이상 쌓이면 표시";
            inner.addView(Ui.text(this, msg, 13, Ui.MUTED, false));
        }
        status.addView(inner, Ui.block(this, 12));
        status.addView(Ui.divider(this, 12));

        File models = new File(getExternalFilesDir(null), ModelFiles.DIR);
        boolean teacher = new File(models, "teacher_params.txt").exists();
        boolean student = new File(models, "student_arousal.txt").exists();
        status.addView(Ui.row(this, "표정 교사", teacher ? "켜짐" : "기준값 대기", teacher ? Ui.OK : Ui.MUTED));
        status.addView(Ui.row(this, "학생 모델", student ? "폰에서 갱신 중" : "씨앗 가중치", student ? Ui.OK : Ui.MUTED));
        if (toggle != null) {
            toggle.setText(running ? "기록 중지" : "기록 시작");
            toggle.setTextColor(running ? Ui.INK : Color.WHITE);
            toggle.setBackground(running ? Ui.rounded(this, Ui.SURFACE, 999, Ui.LINE) : Ui.rounded(this, Ui.PRIMARY, 999, 0));
        }
    }

    /** 권한 카드: 이름·설명 + 허용 여부. 누르면 설정으로. */
    private void renderPerms() {
        perm.removeAllViews();
        perm.addView(Ui.text(this, "권한", 12, Ui.MUTED, true));
        boolean cam = checkSelfPermission(Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        android.app.AppOpsManager ops = (android.app.AppOpsManager) getSystemService(APP_OPS_SERVICE);
        boolean usage = ops.checkOpNoThrow(android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), getPackageName())
                == android.app.AppOpsManager.MODE_ALLOWED;
        boolean notif = getSystemService(android.app.NotificationManager.class)
                .isNotificationListenerAccessGranted(new android.content.ComponentName(this, MediaListener.class));
        boolean overlay = Settings.canDrawOverlays(this);
        perm.addView(permRow("카메라", "표정 계수만 추출, 영상 저장 없음", cam,
                () -> requestPermissions(new String[]{Manifest.permission.CAMERA}, 1)));
        perm.addView(Ui.divider(this, 0));
        perm.addView(permRow("사용 기록", "어떤 앱을 쓰는지", usage,
                () -> startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))));
        perm.addView(Ui.divider(this, 0));
        perm.addView(permRow("알림 접근", "재생 중인 곡·영상 제목", notif,
                () -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));
        perm.addView(Ui.divider(this, 0));
        perm.addView(permRow("다른 앱 위에 표시", "화면 가장자리 좋아/별로/기분 버튼", overlay,
                () -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())))));
    }

    private LinearLayout permRow(String name, String desc, boolean granted, Runnable r) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
        LinearLayout txt = new LinearLayout(this);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.addView(Ui.text(this, name, 15, Ui.INK, true));
        txt.addView(Ui.text(this, desc, 12, Ui.MUTED, false));
        row.addView(txt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(Ui.text(this, granted ? "허용됨" : "설정 ›", 13, granted ? Ui.OK : Ui.PRIMARY, true));
        android.util.TypedValue tv = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true);
        row.setBackgroundResource(tv.resourceId);
        row.setOnClickListener(v -> r.run());
        return row;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        String cmd = intent.getStringExtra("cmd");
        if (cmd == null) return;
        Intent svc = new Intent(this, SensingService.class);
        switch (cmd) {
            case "grid":  // 감정 격자 화면 (테스트·수동 입력용)
                startActivity(new Intent(this, AffectGridActivity.class).putExtra(AffectGridActivity.EXTRA_SRC, "main")
                        .putExtra(AffectGridActivity.EXTRA_PA, 0.62).putExtra(AffectGridActivity.EXTRA_PV, 0.48));
                break;
            case "selftest":
                show("selftest 실행 중...");
                new Thread(this::selftest).start();
                break;
            case "litert_probe":  // T11: LiteRT 온디바이스 학습 프로브 → files/litert_probe.txt
                show("LiteRT 프로브 실행 중...");
                new Thread(() -> {
                    String r = LiteRTProbe.run(this);
                    try {
                        java.io.File f = new java.io.File(getExternalFilesDir(null), "litert_probe.txt");
                        try (java.io.FileWriter w = new java.io.FileWriter(f, true)) {
                            w.write(java.time.Instant.now() + "\n" + r);
                        }
                    } catch (java.io.IOException ignored) {
                    }
                    Log.i(TAG, "LITERT_PROBE " + r);
                    runOnUiThread(() -> show(r));
                }).start();
                break;
            case "start":
                svc.putExtra("hz", intent.getIntExtra("hz", 16));
                svc.putExtra("plan", intent.getStringExtra("plan"));
                svc.putExtra("seg_min", intent.getIntExtra("seg_min", 0));
                svc.putExtra("tag", intent.getStringExtra("tag"));
                startForegroundService(svc);
                show("sensing 시작 hz=" + intent.getIntExtra("hz", 16));
                break;
            case "batch_on":   // T15 배치 모드 켜기(서비스 재시작 후 적용)
            case "batch_off":
                getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit()
                        .putBoolean(LifeLogService.KEY_BATCH, cmd.equals("batch_on")).apply();
                show("batch_mode=" + cmd.equals("batch_on") + " (life_stop → life_start로 적용)");
                break;
            case "batch_plan":  // --es plan cont,batch,cont,batch --ei seg_min 60
                getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit()
                        .putString(LifeLogService.KEY_BATCH_PLAN, intent.getStringExtra("plan"))
                        .putInt(LifeLogService.KEY_BATCH_SEG_MIN, intent.getIntExtra("seg_min", 60)).apply();
                show("batch_plan 저장: " + intent.getStringExtra("plan") + " × " + intent.getIntExtra("seg_min", 60) + "분 (life_start 시 시작)");
                break;
            case "life_start":
                startForegroundService(new Intent(this, LifeLogService.class));
                show("일상 기록 시작");
                break;
            case "life_stop":
                stopService(new Intent(this, LifeLogService.class));
                show("일상 기록 중지");
                break;
            case "viewing":
                startActivity(new Intent(this, ViewingActivity.class).putExtra("n", intent.getIntExtra("n", 12)));
                break;
            case "stop":
                stopService(svc);
                show("sensing 중지");
                break;
            default:
                show("알 수 없는 명령: " + cmd);
        }
    }

    private void show(String s) {
        Log.i(TAG, s);
        runOnUiThread(() -> {
            view.setVisibility(View.VISIBLE);
            view.append(s + "\n");
        });
    }

    /** Python과 같은 WESAD 창을 넣어 특징·확률 일치를 확인하고, 반복 실행으로 지연시간을 잰다. */
    private void selftest() {
        StringBuilder out = new StringBuilder();
        try {
            for (int fs : new int[]{2, 8, 16, 32}) {
                long t0 = System.nanoTime();
                TreeModel model = new TreeModel(getAssets().open("model" + fs + ".txt"));
                double loadMs = (System.nanoTime() - t0) / 1e6;
                BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("selftest" + fs + ".txt")));
                int cases = Integer.parseInt(r.readLine().split(" ")[1]);
                double maxRel = 0, maxProb = 0;
                double[][] lastAcc = null;
                for (int c = 0; c < cases; c++) {
                    int n = Integer.parseInt(r.readLine().split(" ")[1]);
                    double[][] acc = new double[n][3];
                    for (int i = 0; i < n; i++) {
                        String[] p = r.readLine().split(" ");
                        for (int k = 0; k < 3; k++) acc[i][k] = Double.parseDouble(p[k]);
                    }
                    String[] fe = r.readLine().split(" ");
                    double expProb = Double.parseDouble(r.readLine().split(" ")[1]);
                    double[] x = model.vector(Features.compute(acc, fs));
                    for (int i = 0; i < x.length; i++) {
                        double e = Double.parseDouble(fe[i + 1]);
                        maxRel = Math.max(maxRel, Math.abs(x[i] - e) / Math.max(Math.abs(e), 1e-9));
                    }
                    maxProb = Math.max(maxProb, Math.abs(model.predict(x) - expProb));
                    lastAcc = acc;
                }
                // 지연시간: 워밍업 20회 후 200회 측정
                int reps = 200;
                long[] fUs = new long[reps], iUs = new long[reps];
                for (int k = 0; k < 20 + reps; k++) {
                    long a = System.nanoTime();
                    Map<String, Double> f = Features.compute(lastAcc, fs);
                    long b = System.nanoTime();
                    model.predict(model.vector(f));
                    long c = System.nanoTime();
                    if (k >= 20) { fUs[k - 20] = (b - a) / 1000; iUs[k - 20] = (c - b) / 1000; }
                }
                Arrays.sort(fUs);
                Arrays.sort(iUs);
                String line = String.format(Locale.US,
                        "fs=%d cases=%d max_rel_feat_err=%.3e max_prob_err=%.3e model_load_ms=%.1f "
                                + "feat_us_median=%d feat_us_p95=%d infer_us_median=%d infer_us_p95=%d",
                        fs, cases, maxRel, maxProb, loadMs, fUs[reps / 2], fUs[reps * 95 / 100], iUs[reps / 2], iUs[reps * 95 / 100]);
                out.append(line).append('\n');
                show(line);
            }
            String daily = selftestDaily();
            out.append(daily).append('\n');
            show(daily);
            File f = new File(getExternalFilesDir(null), "selftest_result.txt");
            try (FileWriter w = new FileWriter(f)) { w.write(out.toString()); }
            show("SELFTEST_DONE " + f.getAbsolutePath());
        } catch (Exception e) {
            Log.e(TAG, "selftest failed", e);
            show("SELFTEST_FAIL " + e);
        }
    }

    /** 일상 모델: 실제 응답 직전 30분 신호(8Hz 격자)로 32개 특징·각성/정서가 확률이 Python과 같은지, 그리고 시간. */
    private String selftestDaily() throws Exception {
        long l0 = System.nanoTime();
        TreeModel ar = new TreeModel(getAssets().open("daily_arousal.txt"));
        TreeModel va = new TreeModel(getAssets().open("daily_valence.txt"));
        double loadMs = (System.nanoTime() - l0) / 1e6;
        BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("selftest_daily.txt")), 1 << 16);
        int cases = Integer.parseInt(r.readLine().split(" ")[1]);
        double maxRel = 0, maxProb = 0;
        java.util.List<double[][]> lastWins = null;
        int win = DailyEngine.WIN_S * DailyEngine.FS8;
        for (int c = 0; c < cases; c++) {
            int n = Integer.parseInt(r.readLine().split(" ")[1]);
            double[][] u = new double[n][3];
            for (int i = 0; i < n; i++) {
                String[] p = r.readLine().split(" ");
                for (int k = 0; k < 3; k++) u[i][k] = Fixtures.parseDouble(p[k]);
            }
            java.util.List<double[][]> wins = new java.util.ArrayList<>();
            for (int s = 0; s + win <= n; s += win) {
                double[][] w = Arrays.copyOfRange(u, s, s + win);
                boolean ok = true;
                for (double[] row : w) if (Double.isNaN(row[0])) { ok = false; break; }
                if (ok) wins.add(w);
            }
            DailyEngine eng = new DailyEngine(ar, va);
            long t = 0;
            for (double[][] w : wins) eng.addMinute(t += 60_000_000_000L / 2, w);  // 30분 안에 모두 들어가도록
            Map<String, Double> f = eng.summary();
            double[] p = eng.estimate();
            for (int m = 0; m < 2; m++) {
                TreeModel model = m == 0 ? ar : va;
                String[] fe = r.readLine().split(" ");
                double expP = Double.parseDouble(r.readLine().split(" ")[1]);
                double[] x = model.vector(f);
                for (int i = 0; i < x.length; i++) {
                    double e = Double.parseDouble(fe[i + 1]);
                    maxRel = Math.max(maxRel, Math.abs(x[i] - e) / Math.max(Math.abs(e), 1e-9));
                }
                maxProb = Math.max(maxProb, Math.abs(p[m] - expP));
            }
            lastWins = wins;
        }
        // 시간: 분 단계(4개 평균+특징 16개)와 추정 단계(30분 요약+두 모델)
        int reps = 200;
        long[] minUs = new long[reps], estUs = new long[reps];
        DailyEngine eng = new DailyEngine(ar, va);
        long t = 0;
        for (double[][] w : lastWins) eng.addMinute(t += 30_000_000_000L, w);
        for (int k = 0; k < 20 + reps; k++) {
            double[][] w = lastWins.get(k % lastWins.size());
            long a = System.nanoTime();
            Features.compute(DailyEngine.block4(w), 2);
            long b = System.nanoTime();
            eng.estimate();
            long c = System.nanoTime();
            if (k >= 20) { minUs[k - 20] = (b - a) / 1000; estUs[k - 20] = (c - b) / 1000; }
        }
        Arrays.sort(minUs);
        Arrays.sort(estUs);
        return String.format(Locale.US,
                "daily cases=%d windows_last=%d max_rel_feat_err=%.3e max_prob_err=%.3e model_load_ms=%.1f "
                        + "minute_us_median=%d minute_us_p95=%d estimate_us_median=%d estimate_us_p95=%d",
                cases, lastWins.size(), maxRel, maxProb, loadMs, minUs[reps / 2], minUs[reps * 95 / 100],
                estUs[reps / 2], estUs[reps * 95 / 100]);
    }
}
