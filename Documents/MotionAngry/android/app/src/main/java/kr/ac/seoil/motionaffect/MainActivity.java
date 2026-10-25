package kr.ac.seoil.motionaffect;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.widget.Button;
import android.widget.LinearLayout;
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
 */
public class MainActivity extends Activity {
    static final String TAG = "MotionAffect";
    private TextView view;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(32, 32, 32, 32);
        col.addView(button("일상 기록 시작", () -> {
            startForegroundService(new Intent(this, LifeLogService.class));
            show("일상 기록 시작");
        }));
        col.addView(button("일상 기록 중지", () -> {
            stopService(new Intent(this, LifeLogService.class));
            show("일상 기록 중지");
        }));
        col.addView(button("권한 1: 카메라(표정)", () -> requestPermissions(new String[]{Manifest.permission.CAMERA}, 1)));
        col.addView(button("권한 2: 사용 기록(어떤 앱인지)", () -> startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))));
        col.addView(button("권한 3: 알림 접근(곡·영상 제목)", () -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));
        col.addView(button("권한 4: 다른 앱 위에 표시(좋아/별로 버튼)", () -> startActivity(
                new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())))));
        col.addView(button("영상 시청 실험(보조)", () -> startActivity(new Intent(this, ViewingActivity.class))));
        view = new TextView(this);
        view.setText("MotionAffect: 외부 전송 없음 (인터넷 권한 없음)\n");
        col.addView(view);
        setContentView(col);
        handle(getIntent());
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

    private Button button(String label, Runnable r) {
        Button b = new Button(this);
        b.setText(label);
        b.setOnClickListener(v -> r.run());
        return b;
    }

    private void show(String s) {
        Log.i(TAG, s);
        runOnUiThread(() -> view.append(s + "\n"));
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
