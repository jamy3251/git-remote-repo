package kr.ac.seoil.motionaffect;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.BatteryManager;
import android.os.Debug;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Locale;

/**
 * 측정용 전경 서비스. 가속도를 받아 60초 창(15초 간격)마다 특징 추출·추론을 단말에서 실행하고,
 * 지연시간·확률(windows CSV)과 배터리·메모리(system CSV)를 기록한다.
 * hz=0이면 센서·추론 없이 wakelock만 잡는다(비용 분리용 기준 조건).
 * plan="0,16,32,0", seg_min=25 처럼 주면 구간마다 조건을 바꿔 가며 한 번에 측정한다(배터리 실험용).
 */
public class SensingService extends Service implements SensorEventListener {
    private static final double G = 9.80665;
    private static final int WIN_S = 60, HOP_S = 15, SYS_S = 60;
    private static final Object WINDOW_TOKEN = new Object();

    private int hz;
    private int[] plan;
    private long segMs;
    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock wake;
    private SensorManager sm;
    private TreeModel model;
    private FileWriter winLog, sysLog;
    private long startMs;

    // 원시 이벤트 링버퍼 (센서가 요청보다 빠르게 줄 수 있어 넉넉히)
    private static final int CAP = 1 << 15;
    private final long[] ts = new long[CAP];
    private final double[][] xyz = new double[CAP][3];
    private long count;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (thread != null) return START_NOT_STICKY;
        String planArg = intent.getStringExtra("plan");
        if (planArg == null) planArg = String.valueOf(intent.getIntExtra("hz", 16));
        String[] parts = planArg.split(",");
        plan = new int[parts.length];
        for (int i = 0; i < parts.length; i++) plan[i] = Integer.parseInt(parts[i].trim());
        segMs = intent.getIntExtra("seg_min", 0) * 60_000L;
        String tag = intent.getStringExtra("tag");

        startForeground(1, notification());
        wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "motionaffect:sense");
        wake.acquire();
        thread = new HandlerThread("sense");
        thread.start();
        handler = new Handler(thread.getLooper());
        sm = (SensorManager) getSystemService(SENSOR_SERVICE);
        startMs = System.currentTimeMillis();
        String base = String.format(Locale.US, "run_%d_%s%s", startMs, planArg.replace(',', '-'), tag == null ? "" : "_" + tag);
        try {
            File dir = getExternalFilesDir(null);
            winLog = new FileWriter(new File(dir, base + "_windows.csv"));
            winLog.write("elapsed_s,hz,n_raw,eff_hz,feat_us,infer_us,prob\n");
            sysLog = new FileWriter(new File(dir, base + "_system.csv"));
            sysLog.write("elapsed_s,hz,charge_uah,current_ua,level,pss_kb,java_heap_kb,n_events\n");
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "init failed", e);
        }
        handler.post(() -> enter(0));
        handler.post(this::system);
        Log.i(MainActivity.TAG, "service start " + base);
        return START_NOT_STICKY;
    }

    /** i번째 구간 시작: 센서·모델을 그 구간의 hz로 바꾼다. 마지막 구간이 끝나면 서비스 종료. */
    private void enter(int i) {
        if (i >= plan.length) {
            Log.i(MainActivity.TAG, "PLAN_DONE");
            stopSelf();
            return;
        }
        sm.unregisterListener(this);
        handler.removeCallbacksAndMessages(WINDOW_TOKEN);
        hz = plan[i];
        count = 0;
        model = null;
        if (hz > 0) {
            try {
                model = new TreeModel(getAssets().open("model" + hz + ".txt"));
            } catch (IOException e) {
                Log.e(MainActivity.TAG, "model load failed", e);
            }
            Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            sm.registerListener(this, acc, 1_000_000 / hz, handler);
            scheduleWindow((WIN_S + 1) * 1000L);
        }
        Log.i(MainActivity.TAG, "segment " + i + " hz=" + hz);
        if (segMs > 0) handler.postDelayed(() -> enter(i + 1), segMs);
    }

    private void scheduleWindow(long delayMs) {
        handler.postAtTime(this::window, WINDOW_TOKEN, SystemClock.uptimeMillis() + delayMs);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        int i = (int) (count % CAP);
        ts[i] = e.timestamp;
        xyz[i][0] = e.values[0] / G;
        xyz[i][1] = e.values[1] / G;
        xyz[i][2] = e.values[2] / G;
        count++;
    }

    @Override
    public void onAccuracyChanged(Sensor s, int a) {}

    /** 최근 60초를 hz 격자로 선형 보간해 고정 길이 창을 만든 뒤 특징·추론. */
    private void window() {
        if (count < 2 || model == null) {
            scheduleWindow(HOP_S * 1000L);
            return;
        }
        long t0 = System.nanoTime();
        long end = count - 1;
        long tEnd = ts[(int) (end % CAP)];
        long tStart = tEnd - WIN_S * 1_000_000_000L;
        long j = end;
        while (j > 0 && end - j < CAP - 1 && ts[(int) ((j - 1) % CAP)] >= tStart) j--;
        long nRaw = end - j + 1;
        double effHz = (nRaw - 1) / ((tEnd - ts[(int) (j % CAP)]) / 1e9);
        int n = WIN_S * hz;
        double[][] acc = new double[n][3];
        long k = Math.max(j - 1, 0);
        for (int s = 0; s < n; s++) {
            long t = tStart + (long) (s * 1e9 / hz);
            while (k + 1 <= end && ts[(int) ((k + 1) % CAP)] <= t) k++;
            int a = (int) (k % CAP), b = (int) (Math.min(k + 1, end) % CAP);
            double w = ts[b] == ts[a] ? 0 : (double) (t - ts[a]) / (ts[b] - ts[a]);
            w = Math.max(0, Math.min(1, w));
            for (int d = 0; d < 3; d++) acc[s][d] = xyz[a][d] + (xyz[b][d] - xyz[a][d]) * w;
        }
        long t1 = System.nanoTime();
        double[] x = model.vector(Features.compute(acc, hz));
        long t2 = System.nanoTime();
        double p = model.predict(x);
        long t3 = System.nanoTime();
        write(winLog, String.format(Locale.US, "%.1f,%d,%d,%.2f,%d,%d,%.4f\n",
                elapsed(), hz, nRaw, effHz, (t2 - t1) / 1000, (t3 - t2) / 1000, p));
        Log.i(MainActivity.TAG, String.format(Locale.US, "win hz=%d eff_hz=%.1f prep_us=%d feat_us=%d infer_us=%d p=%.3f",
                hz, effHz, (t1 - t0) / 1000, (t2 - t1) / 1000, (t3 - t2) / 1000, p));
        scheduleWindow(HOP_S * 1000L);
    }

    private void system() {
        BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
        Debug.MemoryInfo mi = new Debug.MemoryInfo();
        Debug.getMemoryInfo(mi);
        Runtime rt = Runtime.getRuntime();
        write(sysLog, String.format(Locale.US, "%.1f,%d,%d,%d,%d,%d,%d,%d\n", elapsed(), hz,
                bm.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER),
                bm.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
                bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY),
                mi.getTotalPss(), (rt.totalMemory() - rt.freeMemory()) / 1024, count));
        handler.postDelayed(this::system, SYS_S * 1000L);
    }

    private double elapsed() {
        return (System.currentTimeMillis() - startMs) / 1000.0;
    }

    private static void write(FileWriter w, String s) {
        if (w == null) return;
        try {
            w.write(s);
            w.flush();
        } catch (IOException ignored) {
        }
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("sense", "Sensing", NotificationManager.IMPORTANCE_LOW));
        return new Notification.Builder(this, "sense")
                .setContentTitle("MotionAffect 측정 중")
                .setContentText("단말 내 추론 측정 (외부 전송 없음)")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .build();
    }

    @Override
    public void onDestroy() {
        if (sm != null) sm.unregisterListener(this);
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        if (wake != null && wake.isHeld()) wake.release();
        try {
            if (winLog != null) winLog.close();
            if (sysLog != null) sysLog.close();
        } catch (IOException ignored) {
        }
        Log.i(MainActivity.TAG, "service stop, events=" + count);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }
}
