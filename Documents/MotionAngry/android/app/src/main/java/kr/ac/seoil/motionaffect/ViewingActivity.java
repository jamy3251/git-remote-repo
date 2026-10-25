package kr.ac.seoil.motionaffect;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.VideoView;

import androidx.activity.ComponentActivity;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;

/**
 * S5 파일럿: 영상 시청 중 폰을 쥔 손의 움직임·터치를 기록하고, 클립마다 감정 평가를 받는다.
 * 클립: files/clips/*.mp4 (오프라인). 이미 평가한 클립은 건너뛴다.
 * 흐름: 기준 30초(회색 화면) → 영상 → 평가(정서가·각성·몰입 1~9, 본 적 있음).
 * 출력: files/viewing/session_{ts}_imu.csv, _touch.csv, _face.csv(표정 계수, 카메라 허용 시), ratings.csv(누적)
 * 시각: IMU는 센서 timestamp(elapsedRealtime 기준 ns), 터치는 uptime ms — 구간 구분은 phase·clip 열로 한다.
 */
public class ViewingActivity extends ComponentActivity implements SensorEventListener {
    private static final int BASELINE_S = 30;

    private File outDir;
    private List<File> queue;
    private int idx;
    private long sessionTs;
    private volatile String phase = "idle", clip = "";
    private FaceRecorder face;
    private long clipStartNs, clipEndNs;

    private SensorManager sm;
    private HandlerThread sensorThread;
    private BufferedWriter imu, touch;
    private final Handler ui = new Handler();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        outDir = new File(getExternalFilesDir(null), "viewing");
        outDir.mkdirs();
        File clipDir = new File(getExternalFilesDir(null), "clips");
        clipDir.mkdirs();

        Set<String> done = ratedClips();
        queue = new ArrayList<>();
        File[] all = clipDir.listFiles((d, n) -> n.toLowerCase(Locale.ROOT).endsWith(".mp4"));
        if (all != null) for (File f : all) if (!done.contains(f.getName())) queue.add(f);
        sessionTs = System.currentTimeMillis();
        Collections.shuffle(queue, new Random(sessionTs));

        int perSession = getIntent().getIntExtra("n", 12);
        if (queue.size() > perSession) queue = new ArrayList<>(queue.subList(0, perSession));

        if (queue.isEmpty()) {
            message("평가할 영상이 없습니다.\n" + clipDir.getAbsolutePath() + " 에 mp4를 넣어 주세요.", null);
            return;
        }
        try {
            String base = "session_" + sessionTs;
            imu = new BufferedWriter(new FileWriter(new File(outDir, base + "_imu.csv")));
            imu.write("t_ns,sensor,x,y,z,phase,clip\n");
            touch = new BufferedWriter(new FileWriter(new File(outDir, base + "_touch.csv")));
            touch.write("t_uptime_ms,action,pointers,x,y,pressure,size,touch_major,phase,clip\n");
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "viewing log init failed", e);
        }
        sm = (SensorManager) getSystemService(SENSOR_SERVICE);
        sensorThread = new HandlerThread("viewing-sensors");
        sensorThread.start();
        Handler h = new Handler(sensorThread.getLooper());
        sm.registerListener(this, sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), SensorManager.SENSOR_DELAY_GAME, h);
        sm.registerListener(this, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), SensorManager.SENSOR_DELAY_GAME, h);

        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startFace();
        else requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);

        message("이번 세션: 영상 " + queue.size() + "개\n\n의자에 앉아 두 손으로 폰을 가로로 쥐고, 이어폰을 끼세요.\n"
                + "영상마다 30초 동안 회색 화면을 보며 가만히 있은 뒤 영상이 나옵니다.\n영상이 끝나면 바로 평가합니다.", this::baseline);
    }

    /** 기준 구간: 회색 화면, 남은 시간 표시. */
    private void baseline() {
        clip = queue.get(idx).getName();
        phase = "baseline";
        TextView t = new TextView(this);
        t.setBackgroundColor(Color.rgb(128, 128, 128));
        t.setTextColor(Color.rgb(90, 90, 90));
        t.setGravity(Gravity.CENTER);
        t.setTextSize(20);
        setContentView(t);
        long end = SystemClock.uptimeMillis() + BASELINE_S * 1000L;
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                long left = (end - SystemClock.uptimeMillis() + 999) / 1000;
                if (left <= 0) {
                    play();
                    return;
                }
                t.setText(String.format(Locale.US, "%d / %d\n%d", idx + 1, queue.size(), left));
                ui.postDelayed(this, 250);
            }
        };
        ui.post(tick);
    }

    private void play() {
        phase = "clip";
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        VideoView v = new VideoView(this);
        root.addView(v, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
        setContentView(root);
        v.setVideoURI(Uri.fromFile(queue.get(idx)));
        v.setOnPreparedListener(mp -> {
            clipStartNs = SystemClock.elapsedRealtimeNanos();
            v.start();
        });
        v.setOnCompletionListener(mp -> {
            clipEndNs = SystemClock.elapsedRealtimeNanos();
            rate();
        });
        v.setOnErrorListener((mp, what, extra) -> {
            Log.e(MainActivity.TAG, "video error " + clip + " " + what + "/" + extra);
            clipEndNs = SystemClock.elapsedRealtimeNanos();
            next();
            return true;
        });
    }

    private void rate() {
        phase = "rating";
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(48, 24, 48, 24);
        SeekBar val = scale(col, "정서가: 매우 불쾌 1 ― 5 ― 9 매우 유쾌");
        SeekBar aro = scale(col, "각성: 매우 차분 1 ― 5 ― 9 매우 흥분");
        SeekBar eng = scale(col, "몰입: 전혀 1 ― 5 ― 9 완전히");
        CheckBox seen = new CheckBox(this);
        seen.setText("전에 본 적 있는 영상");
        col.addView(seen);
        Button ok = new Button(this);
        ok.setText("저장하고 다음");
        ok.setOnClickListener(x -> {
            appendRating(val.getProgress() + 1, aro.getProgress() + 1, eng.getProgress() + 1, seen.isChecked());
            next();
        });
        col.addView(ok);
        setContentView(col);
    }

    private SeekBar scale(LinearLayout col, String label) {
        TextView t = new TextView(this);
        t.setTextSize(16);
        col.addView(t);
        SeekBar s = new SeekBar(this);
        s.setMax(8);
        s.setProgress(4);
        s.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar b, int p, boolean u) { t.setText(label + "   [" + (p + 1) + "]"); }
            public void onStartTrackingTouch(SeekBar b) {}
            public void onStopTrackingTouch(SeekBar b) {}
        });
        t.setText(label + "   [5]");
        col.addView(s);
        return s;
    }

    private void next() {
        idx++;
        if (idx < queue.size()) baseline();
        else {
            phase = "idle";
            finishSession();
            message("세션 끝. 수고하셨습니다.", null);
        }
    }

    private void appendRating(int v, int a, int e, boolean seen) {
        File f = new File(outDir, "ratings.csv");
        boolean header = !f.exists();
        try (BufferedWriter w = new BufferedWriter(new FileWriter(f, true))) {
            if (header) w.write("session,order,clip,clip_start_ns,clip_end_ns,valence,arousal,engagement,seen,rated_ms\n");
            w.write(String.format(Locale.US, "%d,%d,%s,%d,%d,%d,%d,%d,%d,%d\n", sessionTs, idx, clip.replace(',', '_'),
                    clipStartNs, clipEndNs, v, a, e, seen ? 1 : 0, System.currentTimeMillis()));
        } catch (IOException ex) {
            Log.e(MainActivity.TAG, "rating write failed", ex);
        }
    }

    private Set<String> ratedClips() {
        Set<String> s = new HashSet<>();
        File f = new File(outDir, "ratings.csv");
        if (!f.exists()) return s;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            r.readLine();
            for (String line; (line = r.readLine()) != null; ) {
                String[] p = line.split(",");
                if (p.length > 2) s.add(p[2]);
            }
        } catch (IOException ignored) {
        }
        return s;
    }

    private void message(String text, Runnable onOk) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(48, 48, 48, 48);
        TextView t = new TextView(this);
        t.setTextSize(17);
        t.setText(text);
        col.addView(t);
        if (onOk != null) {
            Button b = new Button(this);
            b.setText("시작");
            b.setOnClickListener(x -> onOk.run());
            col.addView(b);
        }
        setContentView(col);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (imu == null) return;
        String s = e.sensor.getType() == Sensor.TYPE_GYROSCOPE ? "g" : "a";
        try {
            imu.write(String.format(Locale.US, "%d,%s,%.5f,%.5f,%.5f,%s,%s\n", e.timestamp, s,
                    e.values[0], e.values[1], e.values[2], phase, clip.replace(',', '_')));
        } catch (IOException ignored) {
        }
    }

    @Override
    public void onAccuracyChanged(Sensor s, int a) {}

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (touch != null) {
            try {
                touch.write(String.format(Locale.US, "%d,%d,%d,%.1f,%.1f,%.4f,%.4f,%.2f,%s,%s\n",
                        ev.getEventTime(), ev.getActionMasked(), ev.getPointerCount(), ev.getX(), ev.getY(),
                        ev.getPressure(), ev.getSize(), ev.getTouchMajor(), phase, clip.replace(',', '_')));
            } catch (IOException ignored) {
            }
        }
        return super.dispatchTouchEvent(ev);
    }

    private void startFace() {
        try {
            face = new FaceRecorder(this, new File(outDir, "session_" + sessionTs + "_face.csv"), 5,
                    () -> phase + "," + clip.replace(',', '_'));
            face.start(this);
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "face init failed", e);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED && imu != null) startFace();
    }

    private void finishSession() {
        if (face != null) face.stop();
        face = null;
        if (sm != null) sm.unregisterListener(this);
        if (sensorThread != null) sensorThread.quitSafely();
        try {
            if (imu != null) imu.close();
            if (touch != null) touch.close();
        } catch (IOException ignored) {
        }
        imu = null;
        touch = null;
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        finishSession();
        super.onDestroy();
    }
}
