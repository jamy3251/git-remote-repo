package kr.ac.seoil.motionaffect;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.lifecycle.LifecycleService;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.zip.GZIPOutputStream;

/**
 * S5 일상 기록: 실제로 쓰는 앱(멜론·유튜브·인스타 등)에서 콘텐츠를 볼 때의 손 움직임·표정과,
 * 사용자가 직접 누른 좋아/별로 신호를 쌓는다. 외부 전송 없음(인터넷 권한 없음).
 *
 * 기록 (files/life/)
 * - imu_{시작ms}.csv.gz : 가속도·자이로 원시값 상시(약 50Hz), 1시간마다 새 파일
 * - face_{시작ms}.csv   : 화면이 켜져 있는 동안 앞카메라 표정 계수(초당 FACE_FPS장, 영상은 저장 안 함)
 * - events.csv          : 화면 켜짐/꺼짐, 앞에 띄운 앱, 재생 중 곡·영상 제목, 좋아/별로 입력,
 *                         감정 격자 입력(type=affect: v 정서가·a 각성·i 세기·e 감정 이름·j 추정 맞음 여부·pa/pv 그때 추정),
 *                         질문 알림(type=ask, arm=A 급변|B 무작위), 팔 B 예약(type=ask_sched)·미룸(type=ask_delay)
 * 시각: 모든 파일의 t_ns는 elapsedRealtimeNanos 기준(센서 timestamp와 같은 시계), events에는 벽시계 ms도 같이 적는다.
 */
public class LifeLogService extends LifecycleService implements SensorEventListener {
    static final String ACTION_RATE = "kr.ac.seoil.motionaffect.RATE";
    static final String ACTION_AFFECT = "kr.ac.seoil.motionaffect.AFFECT";
    static final String ACTION_ASK_ALARM = "kr.ac.seoil.motionaffect.ASK_ALARM_SVC";
    // '지금 어떠세요?' 질문 알림 두 팔(AskScheduler): A 급변 트리거, B 하루 3회 난수 시각. 추정값을 같이 넘겨 맞아요/아니에요를 받는다.
    private AskScheduler asker;
    private String modelLoadNote = "";
    private double lastPa = Double.NaN, lastPv = Double.NaN;
    // 2단계(T13/T14): 표정 교사 → 단말 학생(LiteRT) 학습, 접촉 게이팅, 드리프트 가드
    private TeacherRule teacher;
    private OnDeviceTrainer trainA, trainV;
    private DriftGuard guard;
    private double lastPsa = Double.NaN, lastPsv = Double.NaN;
    private volatile boolean charging;
    private static final long TRAIN_MS = 60 * 60_000L;
    private static final String KEY_STUDENT_ACTIVE = "student_active";
    // 3단계(T15): 배치 모드 — 화면 꺼짐 동안 자이로 해제 + 가속도 FIFO 배치(300s). 측정 조건이며 수집은 계속된다
    static final String KEY_BATCH = "batch_mode";
    static final String KEY_BATCH_PLAN = "batch_plan";      // 예: "cont,batch,cont,batch"
    static final String KEY_BATCH_SEG_MIN = "batch_seg_min";
    private boolean batchMode, batchedNow;
    private long imuStatN, imuStatMaxGapNs, imuLastNs;
    private static final long IMU_STAT_MS = 5 * 60_000L;
    private static final int FACE_FPS = 2;
    private static final long ROTATE_MS = 60 * 60_000L, APP_POLL_MS = 3000, FLUSH_MS = 10_000;

    private File dir;
    private HandlerThread thread;
    private Handler h;
    private SensorManager sm;
    private PowerManager.WakeLock wake;
    private BufferedWriter imu, events;
    private long imuOpenedMs;
    // 단말 내 일상 정서 추정: 가속도 링 버퍼(g) → 1분마다 DailyEngine
    private static final int CAP = 1 << 14;
    private static final double G = 9.80665;
    private static final long MINUTE_MS = 60_000;
    private final long[] ats = new long[CAP];
    private final double[][] axyz = new double[CAP][3];
    private long acount;
    private DailyEngine daily;
    private BufferedWriter affect;
    private String lastEstimate = "추정 준비 중 (5분 이상 필요)";
    private FaceRecorder face;
    private volatile String app = "", media = "";
    private volatile boolean screenOn;
    private java.util.List<String> featKeys;  // affect.csv v2 열 순서(키 오름차순으로 고정)
    private long lastUsageQuery;
    private View overlay;
    private MediaSessionManager msm;
    private final MediaController.Callback mediaCb = new MediaController.Callback() {
        @Override public void onMetadataChanged(MediaMetadata m) { logMedia(); }
        @Override public void onPlaybackStateChanged(PlaybackState s) { logMedia(); }
    };
    private List<MediaController> controllers;

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            boolean on = Intent.ACTION_SCREEN_ON.equals(i.getAction());
            screenOn = on;
            event(on ? "screen_on" : "screen_off", "");
            if (on) startFace();
            else stopFace();
            if (batchMode) h.post(() -> applySensorMode(!on));
        }
    };

    private final BroadcastReceiver battery = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            int plugged = i.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0);
            boolean now = plugged != 0;
            if (now != charging) {
                charging = now;
                event(now ? "charge_on" : "charge_off", "");
            }
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        super.onStartCommand(intent, flags, startId);
        if (intent != null && (ACTION_RATE.equals(intent.getAction()) || ACTION_AFFECT.equals(intent.getAction()))) {
            boolean affectIn = ACTION_AFFECT.equals(intent.getAction());
            String value = intent.getStringExtra("value");
            if (thread == null) {
                // 서비스가 꺼진 상태에서 들어온 입력: 잃지 않고 pending에 적고, 기록은 시작하지 않는다
                try {
                    PendingEvents.append(new File(getExternalFilesDir(null), "life"), SystemClock.elapsedRealtimeNanos(),
                            System.currentTimeMillis(), affectIn ? "affect" : "rate", value);
                } catch (IOException e) {
                    Log.e(MainActivity.TAG, "pending event failed", e);
                }
                if (affectIn) getSystemService(NotificationManager.class).cancel(3);
                stopSelf();
                return START_NOT_STICKY;
            }
            if (affectIn) {
                event("affect", value);
                Log.i(MainActivity.TAG, "affect " + value);
                getSystemService(NotificationManager.class).cancel(3);
                scoreGuard(value);
            } else {
                rate(value);
            }
            return START_STICKY;
        }
        if (intent != null && ACTION_ASK_ALARM.equals(intent.getAction()) && thread != null) {
            asker.onAlarm(intent.getIntExtra("idx", -1));
            return START_STICKY;
        }
        if (thread != null) return START_STICKY;
        getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit().putBoolean(AskAlarmReceiver.KEY_RUNNING, true).apply();
        dir = new File(getExternalFilesDir(null), "life");
        dir.mkdirs();
        startForeground(2, notification());
        try {
            // files/models/가 있으면 우선(재빌드 없이 교체), 손상이면 assets로 폴백. 결과는 events.csv model_load에 기록(이벤트 파일을 연 뒤)
            ModelFiles.Result<TreeModel> ar = ModelFiles.load(this, "daily_arousal.txt", TreeModel::new);
            ModelFiles.Result<TreeModel> va = ModelFiles.load(this, "daily_valence.txt", TreeModel::new);
            modelLoadNote = ar.describe("daily_arousal.txt") + "|" + va.describe("daily_valence.txt");
            daily = new DailyEngine(ar.model, va.model);
            File af = new File(dir, "affect.csv");
            // v1 파일(열 8개)이 남아 있으면 이름을 바꿔 보관하고 v2를 새로 연다(열 수가 달라 섞지 않음)
            featKeys = AffectRow.keys(Features.compute(new double[120][3], 2));
            if (af.exists() && !sameHeader(af, AffectRow.header(featKeys)))
                af.renameTo(new File(dir, "affect_old_" + System.currentTimeMillis() + ".csv"));
            boolean head = !af.exists();
            affect = new BufferedWriter(new FileWriter(af, true));
            if (head) affect.write(AffectRow.header(featKeys));
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "daily model load failed", e);
        }
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "motionaffect:life");
        wake.acquire();
        thread = new HandlerThread("life");
        thread.start();
        h = new Handler(thread.getLooper());
        try {
            File ev = new File(dir, "events.csv");
            boolean header = !ev.exists();
            events = new BufferedWriter(new FileWriter(ev, true));
            if (header) events.write("t_ns,wall_ms,type,app,media,value\n");
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "events open failed", e);
        }
        event("log_start", "");
        event("model_load", modelLoadNote);
        setupStage2();
        batchMode = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getBoolean(KEY_BATCH, false);
        event("batch_mode", batchMode ? "on" : "off");
        try {
            int n = PendingEvents.drainInto(dir, events);
            if (n > 0) event("pending_merged", "n=" + n);
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "pending merge failed", e);
        }
        h.post(this::openImu);
        sm = (SensorManager) getSystemService(SENSOR_SERVICE);
        sm.registerListener(this, sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER), SensorManager.SENSOR_DELAY_GAME, h);
        sm.registerListener(this, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), SensorManager.SENSOR_DELAY_GAME, h);
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screen, f);
        Intent bat = registerReceiver(battery, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        charging = bat != null && bat.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, 0) != 0;
        screenOn = ((PowerManager) getSystemService(POWER_SERVICE)).isInteractive();
        if (screenOn) startFace();
        if (batchMode) h.post(() -> applySensorMode(!screenOn));
        h.postDelayed(this::imuStats, IMU_STAT_MS);
        h.postDelayed(this::trainTick, TRAIN_MS);
        scheduleBatchPlan();
        h.post(this::pollApp);
        h.postDelayed(this::flush, FLUSH_MS);
        h.postDelayed(this::minute, MINUTE_MS);
        watchMedia();
        showOverlay();
        asker = new AskScheduler(System::currentTimeMillis, new AskScheduler.Alarms() {
            @Override public void set(int idx, long atMs) {
                getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, alarmIntent(idx));
            }
            @Override public void cancel(int idx) { getSystemService(AlarmManager.class).cancel(alarmIntent(idx)); }
        }, new AskScheduler.Store() {
            @Override public String get(String key) { return getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getString(key, null); }
            @Override public void put(String key, String value) { getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit().putString(key, value).apply(); }
        }, new AskScheduler.Sink() {
            @Override public void record(String type, String value) { event(type, value); }
            @Override public void fire(String arm, double pa, double pv) { askNotification(arm, pa); }
        }, new java.util.Random(), java.util.TimeZone.getDefault());
        asker.start();
        // 서비스가 죽었다가 알람으로 되살아난 경우: 초기화가 끝난 뒤 그 알람을 처리
        if (intent != null && ACTION_ASK_ALARM.equals(intent.getAction())) asker.onAlarm(intent.getIntExtra("idx", -1));
        return START_STICKY;
    }

    private PendingIntent alarmIntent(int idx) {
        Intent i = new Intent(this, AskAlarmReceiver.class).setAction(AskAlarmReceiver.ACTION_ALARM).putExtra("idx", idx);
        return PendingIntent.getBroadcast(this, 100 + idx, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---------- IMU ----------
    private void openImu() {
        closeImu();
        imuOpenedMs = System.currentTimeMillis();
        try {
            imu = new BufferedWriter(new OutputStreamWriter(new GZIPOutputStream(
                    new FileOutputStream(new File(dir, "imu_" + imuOpenedMs + ".csv.gz")), 1 << 16, true)), 1 << 16);
            imu.write("t_ns,sensor,x,y,z\n");
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "imu open failed", e);
        }
        h.postDelayed(this::openImu, ROTATE_MS);
    }

    private void closeImu() {
        if (imu == null) return;
        try {
            imu.close();
        } catch (IOException ignored) {
        }
        imu = null;
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            if (imuLastNs != 0 && e.timestamp - imuLastNs > imuStatMaxGapNs) imuStatMaxGapNs = e.timestamp - imuLastNs;
            imuLastNs = e.timestamp;
            imuStatN++;
            int i = (int) (acount % CAP);
            ats[i] = e.timestamp;
            axyz[i][0] = e.values[0] / G;
            axyz[i][1] = e.values[1] / G;
            axyz[i][2] = e.values[2] / G;
            acount++;
        }
        if (imu == null) return;
        try {
            imu.write(String.format(Locale.US, "%d,%s,%.4f,%.4f,%.4f\n", e.timestamp,
                    e.sensor.getType() == Sensor.TYPE_GYROSCOPE ? "g" : "a", e.values[0], e.values[1], e.values[2]));
        } catch (IOException ignored) {
        }
    }

    @Override
    public void onAccuracyChanged(Sensor s, int a) {}

    /** 1분마다: 최근 60초 → 분 특징, 5분 이상 쌓이면 각성·정서가 확률을 기록하고 알림에 표시. */
    private void minute() {
        h.postDelayed(this::minute, MINUTE_MS);
        if (daily == null || acount < 2) return;
        long end = acount - 1, tEnd = ats[(int) (end % CAP)];
        long j = end;
        while (j > 0 && end - j < CAP - 1 && ats[(int) ((j - 1) % CAP)] >= tEnd - 61_000_000_000L) j--;
        int n = (int) (end - j + 1);
        long[] t = new long[n];
        double[][] x = new double[n][];
        for (int k = 0; k < n; k++) {
            int i = (int) ((j + k) % CAP);
            t[k] = ats[i];
            x[k] = axyz[i].clone();
        }
        long a = System.nanoTime();
        double[][] w = DailyEngine.grid8(t, x, n, tEnd);
        double[] faceAgg = face != null ? face.drainMinute() : null;
        if (w == null) return;
        daily.addMinute(tEnd, w);
        long b = System.nanoTime();
        Map<String, Double> lastMin = daily.lastMinute();
        Double stillFrac = lastMin == null ? null : lastMin.get("still_frac");
        boolean contact = ContactGate.contact(charging, screenOn, stillFrac == null ? 0 : stillFrac);
        double[] p = contact ? daily.estimate() : null;   // 비접촉이면 추정 보류(기록은 계속)
        long c = System.nanoTime();
        double[] posture = PostureRule.classify(w, screenOn);
        Map<String, Double> summary = daily.summary();
        // 학생: 30분 요약으로 추정, 표정 교사 라벨이 있으면 학습 표본에 추가
        double[] student = new double[]{Double.NaN, Double.NaN};
        if (summary != null && trainA != null && daily.minutes() >= DailyEngine.MIN_WINDOWS) {
            float[] xv = trainA.vector(summary);
            if (xv != null) {
                student[0] = trainA.predict(xv);
                student[1] = trainV.predict(xv);
                int[] lab = teacher != null ? teacher.label(faceAgg) : null;
                if (lab != null) {
                    trainV.add(xv, lab[0]);
                    trainA.add(xv, lab[1]);
                }
            }
        }
        try {
            affect.write(AffectRow.row(SystemClock.elapsedRealtimeNanos(), System.currentTimeMillis(), daily.minutes(), p,
                    (b - a) / 1000, p == null ? 0 : (c - b) / 1000, app, screenOn, posture, faceAgg,
                    lastMin, summary, featKeys, student, contact ? 1 : 0));
            affect.flush();
        } catch (IOException ignored) {
        }
        if (p == null) return;
        lastPa = p[0];
        lastPv = p[1];
        lastPsa = student[0];
        lastPsv = student[1];
        // 알림·팔 A 트리거에 쓰는 '활성' 모델: 가드가 학생을 켰고 학생 값이 있으면 학생, 아니면 출하
        boolean useStudent = guard != null && guard.studentActive() && !Double.isNaN(student[0]);
        double ua = useStudent ? student[0] : p[0], uv = useStudent ? student[1] : p[1];
        lastEstimate = String.format(Locale.US, "최근 %d분: 각성 %.2f · 기분 %.2f%s", daily.minutes(), ua, uv, useStudent ? " (학생)" : "");
        getSystemService(NotificationManager.class).notify(2, notification());
        if (asker != null) asker.onEstimate(ua, uv);
    }

    // ---------- 2단계: 교사·학생·가드 ----------
    private void setupStage2() {
        try {
            File tp = new File(new File(getExternalFilesDir(null), ModelFiles.DIR), "teacher_params.txt");
            if (tp.exists()) {
                try (java.io.FileInputStream in = new java.io.FileInputStream(tp)) { teacher = TeacherRule.parse(in); }
                event("teacher", String.format(Locale.US, "theta_v=%.4f;theta_a=%.4f;conf_min=%.2f", teacher.thetaV, teacher.thetaA, teacher.confMin));
            } else {
                event("teacher", "none");
            }
        } catch (Exception e) {
            teacher = null;
            event("teacher", "error=" + e.getClass().getSimpleName());
        }
        try {
            trainA = new OnDeviceTrainer(this, "arousal");
            trainV = new OnDeviceTrainer(this, "valence");
            event("student", OnDeviceTrainer.describe(trainA) + "|" + OnDeviceTrainer.describe(trainV));
        } catch (Throwable e) {
            trainA = trainV = null;
            event("student", "error=" + e.getClass().getSimpleName() + ":" + String.valueOf(e.getMessage()).replace(',', ' '));
        }
        boolean active = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getBoolean(KEY_STUDENT_ACTIVE, false);
        guard = new DriftGuard((t, v) -> {
            event(t, v);
            getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit().putBoolean(KEY_STUDENT_ACTIVE, guard.studentActive()).apply();
        }, active);
    }

    /** 1시간마다: 교사 표본이 충분하면 학생을 100스텝 학습하고 files/models/student_<task>.txt로 저장. */
    private void trainTick() {
        h.postDelayed(this::trainTick, TRAIN_MS);
        if (trainA == null) return;
        try {
            long t0 = System.nanoTime();
            double la = trainA.train(), lv = trainV.train();
            double ms = (System.nanoTime() - t0) / 1e6;
            if (la >= 0 || lv >= 0) {
                trainA.save(this);
                trainV.save(this);
            }
            event("train", String.format(Locale.US, "samples=%d;loss_a=%.4f;loss_v=%.4f;ms=%.1f;steps=%d", trainA.samples(), la, lv, ms, trainA.trained));
        } catch (Exception e) {
            event("train", "error=" + e.getClass().getSimpleName());
        }
    }

    /** 팔 B 격자 응답으로 출하·학생을 같은 탭에 채점(R8). */
    private void scoreGuard(String value) {
        if (guard == null || value == null || !value.contains("src=ask_B")) return;
        double a = Double.NaN, pa = Double.NaN, psa = Double.NaN;
        for (String part : value.split(";")) {
            String[] kv = part.split("=", 2);
            if (kv.length < 2) continue;
            switch (kv[0]) {
                case "a": a = Fixtures.parseDouble(kv[1]); break;
                case "pa": pa = Fixtures.parseDouble(kv[1]); break;
                case "psa": psa = Fixtures.parseDouble(kv[1]); break;
                default: break;
            }
        }
        if (Double.isNaN(a) || a == 0) return;
        guard.score(System.currentTimeMillis(), a > 0 ? 1 : 0, pa, psa);
    }

    // ---------- 3단계: 배치 모드·IMU 통계 ----------
    /** batched=true: 자이로 해제, 가속도를 NORMAL + maxReportLatency 300s로 재등록(FIFO 배치). false: 둘 다 GAME 연속. */
    private void applySensorMode(boolean batched) {
        if (sm == null || batched == batchedNow) return;
        sm.unregisterListener(this);
        Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (batched) {
            sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_NORMAL, 300_000_000, h);
        } else {
            sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME, h);
            sm.registerListener(this, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), SensorManager.SENSOR_DELAY_GAME, h);
        }
        batchedNow = batched;
        event("sensor_mode", batched ? "batched;acc_latency_s=300;gyro=off" : "continuous;gyro=on");
    }

    /** 5분마다 가속도 수신 통계와 배터리 상태를 기록(배치 실험 분석용). */
    private void imuStats() {
        h.postDelayed(this::imuStats, IMU_STAT_MS);
        android.os.BatteryManager bm = getSystemService(android.os.BatteryManager.class);
        long charge = bm == null ? -1 : bm.getLongProperty(android.os.BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
        int level = bm == null ? -1 : bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
        event("imu_stats", String.format(Locale.US, "n=%d;eff_hz=%.1f;max_gap_ms=%.0f;batched=%d;screen=%d;charging=%d;level=%d;charge_uah=%d",
                imuStatN, imuStatN / (IMU_STAT_MS / 1000.0), imuStatMaxGapNs / 1e6, batchedNow ? 1 : 0, screenOn ? 1 : 0, charging ? 1 : 0, level, charge));
        imuStatN = 0;
        imuStatMaxGapNs = 0;
    }

    /** 실험 계획(prefs): "cont,batch,cont,batch" × seg_min. 구간마다 batchMode를 바꾸고 기록한다. */
    private void scheduleBatchPlan() {
        String plan = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getString(KEY_BATCH_PLAN, null);
        int segMin = getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).getInt(KEY_BATCH_SEG_MIN, 60);
        if (plan == null || plan.isEmpty()) return;
        String[] segs = plan.split(",");
        for (int i = 0; i < segs.length; i++) {
            final boolean b = segs[i].trim().startsWith("batch");
            final int idx = i;
            h.postDelayed(() -> {
                batchMode = b;
                event("batch_plan_seg", "idx=" + idx + ";mode=" + (b ? "batch" : "cont"));
                applySensorMode(b && !screenOn);
            }, (long) i * segMin * 60_000L);
        }
        h.postDelayed(() -> {
            event("batch_plan_end", "");
            getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit().remove(KEY_BATCH_PLAN).apply();
        }, (long) segs.length * segMin * 60_000L);
    }

    /** 질문 알림(두 팔 공용). 격자 화면에 팔 이름(src=ask_A|ask_B)과 그 시점 추정을 넘긴다. */
    private void askNotification(String arm, double pa) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("ask", "지금 어떠세요?", NotificationManager.IMPORTANCE_DEFAULT));
        String text = "A".equals(arm)
                ? String.format(Locale.US, "폰 추정이 바뀌었어요 (각성 %.2f). 한 번만 눌러 주세요", pa)
                : "정해진 시간이에요. 지금 끌리는 색을 한 번만 눌러 주세요";
        nm.notify(3, new Notification.Builder(this, "ask")
                .setContentTitle("지금 어떠세요?")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentIntent(gridIntent("ask_" + arm, 4))
                .setAutoCancel(true)
                .build());
    }

    private static boolean sameHeader(File f, String header) {
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(f))) {
            String h = r.readLine();
            return h != null && (h + "\n").equals(header);
        } catch (IOException e) {
            return false;
        }
    }

    private void flush() {
        try {
            if (imu != null) imu.flush();
            if (events != null) events.flush();
        } catch (IOException ignored) {
        }
        h.postDelayed(this::flush, FLUSH_MS);
    }

    // ---------- 표정 ----------
    private void startFace() {
        if (face != null || checkSelfPermission(android.Manifest.permission.CAMERA) != 0) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                face = new FaceRecorder(this, new File(dir, "face_" + System.currentTimeMillis() + ".csv"), FACE_FPS,
                        () -> "screen," + app.replace(',', '_'));
                face.start(this);
            } catch (Exception e) {
                Log.e(MainActivity.TAG, "face start failed", e);
                face = null;
            }
        });
    }

    private void stopFace() {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (face != null) face.stop();
            face = null;
        });
    }

    // ---------- 앱·미디어 맥락 ----------
    /** 사용 기록 권한이 있을 때 마지막으로 앞에 온 앱을 기록. */
    private void pollApp() {
        try {
            UsageStatsManager um = (UsageStatsManager) getSystemService(USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            UsageEvents ue = um.queryEvents(lastUsageQuery == 0 ? now - 60_000 : lastUsageQuery, now);
            lastUsageQuery = now;
            UsageEvents.Event e = new UsageEvents.Event();
            String latest = null;
            while (ue.hasNextEvent()) {
                ue.getNextEvent(e);
                if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) latest = e.getPackageName();
            }
            if (latest != null && !latest.equals(app)) {
                app = latest;
                event("app", "");
            }
        } catch (Exception ignored) {
        }
        h.postDelayed(this::pollApp, APP_POLL_MS);
    }

    /** 알림 접근 권한이 있을 때 재생 중인 곡·영상 제목을 읽는다. */
    private void watchMedia() {
        try {
            msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
            ComponentName cn = new ComponentName(this, MediaListener.class);
            MediaSessionManager.OnActiveSessionsChangedListener l = list -> {
                if (controllers != null) for (MediaController c : controllers) c.unregisterCallback(mediaCb);
                controllers = list;
                if (list != null) for (MediaController c : list) c.registerCallback(mediaCb, h);
                logMedia();
            };
            msm.addOnActiveSessionsChangedListener(l, cn, h);
            l.onActiveSessionsChanged(msm.getActiveSessions(cn));
        } catch (SecurityException e) {
            event("note", "media_permission_missing");
        }
    }

    private void logMedia() {
        String m = "";
        if (controllers != null) {
            for (MediaController c : controllers) {
                PlaybackState st = c.getPlaybackState();
                MediaMetadata md = c.getMetadata();
                if (st != null && st.getState() == PlaybackState.STATE_PLAYING && md != null) {
                    String t = md.getString(MediaMetadata.METADATA_KEY_TITLE);
                    String a = md.getString(MediaMetadata.METADATA_KEY_ARTIST);
                    m = c.getPackageName() + "|" + (t == null ? "" : t) + "|" + (a == null ? "" : a);
                    break;
                }
            }
        }
        m = m.replace(',', ' ').replace('\n', ' ');
        if (!m.equals(media)) {
            media = m;
            event("media", "");
        }
    }

    // ---------- 좋아/별로 ----------
    private void rate(String value) {
        event("rate", value == null ? "" : value);
        Log.i(MainActivity.TAG, "rate " + value + " app=" + app);
    }

    private void showOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            event("note", "overlay_permission_missing");
            return;
        }
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.addView(button("좋아", "like", Color.argb(150, 31, 95, 168)));
        bar.addView(button("별로", "dislike", Color.argb(150, 120, 120, 120)));
        TextView g = button("감정", "", Color.argb(150, 168, 95, 31));
        g.setOnClickListener(v -> {
            try { gridIntent("overlay", 5).send(); } catch (Exception ignored) {}
        });
        bar.addView(g);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
        ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(bar, lp);
        overlay = bar;
    }

    private TextView button(String label, String value, int bg) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(13);
        b.setPadding(24, 28, 24, 28);
        b.setBackgroundColor(bg);
        b.setOnClickListener(v -> {
            rate(value);
            v.setAlpha(0.3f);
            v.postDelayed(() -> v.setAlpha(1f), 400);
        });
        return b;
    }

    // ---------- 공통 ----------
    private void event(String type, String value) {
        if (events == null) return;
        try {
            synchronized (this) {
                events.write(String.format(Locale.US, "%d,%d,%s,%s,%s,%s\n", SystemClock.elapsedRealtimeNanos(),
                        System.currentTimeMillis(), type, app.replace(',', '_'), media, value));
            }
        } catch (IOException ignored) {
        }
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("life", "일상 기록", NotificationManager.IMPORTANCE_LOW));
        return new Notification.Builder(this, "life")
                .setContentTitle("MotionAffect 일상 기록 중")
                .setContentText(lastEstimate + " · 외부 전송 없음")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .addAction(new Notification.Action.Builder(null, "좋아", rateIntent("like", 1)).build())
                .addAction(new Notification.Action.Builder(null, "별로", rateIntent("dislike", 2)).build())
                .addAction(new Notification.Action.Builder(null, "감정", gridIntent("notification", 3)).build())
                .build();
    }

    /** 감정 격자 화면. 현재 단말 추정이 있으면 같이 넘긴다. */
    private PendingIntent gridIntent(String src, int code) {
        Intent i = new Intent(this, AffectGridActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(AffectGridActivity.EXTRA_SRC, src);
        if (!Double.isNaN(lastPa)) {
            i.putExtra(AffectGridActivity.EXTRA_PA, lastPa).putExtra(AffectGridActivity.EXTRA_PV, lastPv);
        }
        if (!Double.isNaN(lastPsa)) {
            i.putExtra(AffectGridActivity.EXTRA_PSA, lastPsa).putExtra(AffectGridActivity.EXTRA_PSV, lastPsv);
        }
        return PendingIntent.getActivity(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent rateIntent(String value, int code) {
        Intent i = new Intent(this, LifeLogService.class).setAction(ACTION_RATE).putExtra("value", value);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onDestroy() {
        event("log_stop", "");
        getSharedPreferences(AskAlarmReceiver.PREFS, MODE_PRIVATE).edit().putBoolean(AskAlarmReceiver.KEY_RUNNING, false).apply();
        if (asker != null) for (int i = 0; i < AskScheduler.K; i++) getSystemService(AlarmManager.class).cancel(alarmIntent(i));
        if (asker != null) getSystemService(AlarmManager.class).cancel(alarmIntent(AskScheduler.IDX_MIDNIGHT));
        try { unregisterReceiver(screen); } catch (Exception ignored) {}
        try { unregisterReceiver(battery); } catch (Exception ignored) {}
        try { if (trainA != null) { trainA.save(this); trainV.save(this); trainA.close(); trainV.close(); } } catch (Exception ignored) {}
        if (sm != null) sm.unregisterListener(this);
        if (controllers != null) for (MediaController c : controllers) c.unregisterCallback(mediaCb);
        if (overlay != null) ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(overlay);
        if (face != null) face.stop();
        if (h != null) h.removeCallbacksAndMessages(null);
        if (h != null) h.post(() -> {
            closeImu();
            try {
                if (affect != null) affect.close();
                if (events != null) events.close();
            } catch (IOException ignored) {
            }
            thread.quitSafely();
        });
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }
}
