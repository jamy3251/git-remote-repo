package kr.ac.seoil.motionaffect;

import java.util.Calendar;
import java.util.Locale;
import java.util.Random;
import java.util.TimeZone;

/**
 * "지금 어떠세요?" 질문 알림의 두 팔(설계 R1/R11).
 *  팔 A: 각성 추정이 지난 질문 시점보다 ASK_DELTA 이상 움직였고 30분이 지났을 때(기존 동작).
 *  팔 B: 하루 K회, 09~23시 안의 균등 난수 시각. B끼리 ≥30분, A 발화와 ≥15분. 모델 상태와 무관하게 미리 예약한다.
 * 평가는 팔 B 응답으로만 한다(급변 때만 물으면 정답 수집이 모델 출력에 조건화되기 때문).
 *
 * 시계·알람·저장소·기록은 인터페이스로 받아 단위 테스트가 가능하다. 알람은 AlarmManager가 OS 수준에서 지키므로
 * 프로세스가 죽어도 남고, 그날의 계획은 Store에 저장해 재시작·재부팅 뒤에도 같은 시각을 다시 등록한다(ask_sched 중복 없음).
 * 기록: 예약 시 events.csv type=ask_sched (arm=B;idx;at=벽시계ms), 발화 시 type=ask (arm=A|B;pa;pv), 미룸 시 type=ask_delay.
 */
final class AskScheduler {
    interface Clock { long nowMs(); }
    interface Alarms { void set(int idx, long atMs); void cancel(int idx); }
    interface Store { String get(String key); void put(String key, String value); }
    interface Sink {
        void record(String type, String value);
        /** 알림을 띄운다. pa/pv는 그 시점의 단말 추정(없으면 NaN). */
        void fire(String arm, double pa, double pv);
    }

    static final int K = 3;
    static final int IDX_MIDNIGHT = 99;
    static final int WINDOW_START_H = 9, WINDOW_END_H = 23;
    static final long MIN_GAP_B_MS = 30 * 60_000L;     // B끼리
    static final long MIN_GAP_AB_MS = 15 * 60_000L;    // A와 B 사이
    static final long ASK_MIN_GAP_MS = 30 * 60_000L;   // 팔 A 연속 발화 간격
    static final double ASK_DELTA = 0.25;
    private static final String KEY_PLAN = "askB.plan";  // "dayStartMs:t0,t1,t2"

    private final Clock clock;
    private final Alarms alarms;
    private final Store store;
    private final Sink sink;
    private final Random rng;
    private final TimeZone tz;

    private final long[] planned = new long[K];
    private long dayStart;
    private double lastPa = Double.NaN, lastPv = Double.NaN, askedPa = Double.NaN;
    private long lastAMs = Long.MIN_VALUE / 2, lastBMs = Long.MIN_VALUE / 2;

    AskScheduler(Clock clock, Alarms alarms, Store store, Sink sink, Random rng, TimeZone tz) {
        this.clock = clock;
        this.alarms = alarms;
        this.store = store;
        this.sink = sink;
        this.rng = rng;
        this.tz = tz;
    }

    // ---------- 팔 B ----------
    /** 서비스 시작 시: 오늘 계획이 저장돼 있으면 그대로(남은 것만 재등록), 없으면 새로 뽑는다. 자정 알람도 건다. */
    void start() {
        long now = clock.nowMs();
        long today = startOfDay(now);
        long[] saved = loadPlan(today);
        if (saved != null) {
            dayStart = today;
            System.arraycopy(saved, 0, planned, 0, K);
            for (int i = 0; i < K; i++) {
                if (planned[i] > now) alarms.set(i, planned[i]);
            }
        } else {
            scheduleDay(today, now);
        }
        alarms.set(IDX_MIDNIGHT, today + 86_400_000L);
    }

    /** 하루치 난수 시각 K개를 뽑아 예약·기록한다. 이미 지난 시각은 예약하지 않는다. */
    void scheduleDay(long dayStartMs, long now) {
        dayStart = dayStartMs;
        long[] t = drawDay(dayStartMs, rng);
        System.arraycopy(t, 0, planned, 0, K);
        savePlan();
        for (int i = 0; i < K; i++) {
            alarms.cancel(i);
            sink.record("ask_sched", String.format(Locale.US, "arm=B;idx=%d;at=%d;future=%d", i, t[i], t[i] > now ? 1 : 0));
            if (t[i] > now) alarms.set(i, t[i]);
        }
    }

    /** 09~23시 안 균등 난수 K개, 서로 ≥30분(기각 샘플링, 실패 시 균등 간격). 오름차순. */
    static long[] drawDay(long dayStartMs, Random rng) {
        long lo = dayStartMs + WINDOW_START_H * 3_600_000L;
        long hi = dayStartMs + WINDOW_END_H * 3_600_000L;
        for (int attempt = 0; attempt < 200; attempt++) {
            long[] t = new long[K];
            for (int i = 0; i < K; i++) t[i] = lo + (long) (rng.nextDouble() * (hi - lo));
            java.util.Arrays.sort(t);
            boolean ok = true;
            for (int i = 1; i < K; i++) if (t[i] - t[i - 1] < MIN_GAP_B_MS) { ok = false; break; }
            if (ok) return t;
        }
        long[] t = new long[K];
        long step = (hi - lo) / (K + 1);
        for (int i = 0; i < K; i++) t[i] = lo + step * (i + 1);
        return t;
    }

    /** 알람 수신. 자정이면 다음 날 계획, 아니면 팔 B 발화(A 직후 15분 안이면 15분 미룸). */
    void onAlarm(int idx) {
        long now = clock.nowMs();
        if (idx == IDX_MIDNIGHT) {
            long today = startOfDay(now);
            scheduleDay(today, now);
            alarms.set(IDX_MIDNIGHT, today + 86_400_000L);
            return;
        }
        if (idx < 0 || idx >= K) return;
        if (now - lastAMs < MIN_GAP_AB_MS) {
            long at = now + MIN_GAP_AB_MS;
            planned[idx] = at;
            savePlan();
            sink.record("ask_delay", String.format(Locale.US, "arm=B;idx=%d;at=%d", idx, at));
            alarms.set(idx, at);
            return;
        }
        lastBMs = now;
        fire("B");
    }

    // ---------- 팔 A ----------
    /** 1분마다 단말 추정이 갱신될 때 호출. */
    void onEstimate(double pa, double pv) {
        lastPa = pa;
        lastPv = pv;
        long now = clock.nowMs();
        if (Double.isNaN(askedPa)) { askedPa = pa; lastAMs = now; return; }
        if (Math.abs(pa - askedPa) < ASK_DELTA || now - lastAMs < ASK_MIN_GAP_MS) return;
        if (now - lastBMs < MIN_GAP_AB_MS) return;  // B 직후엔 A를 쉬어 두 팔이 겹치지 않게
        askedPa = pa;
        lastAMs = now;
        fire("A");
    }

    private void fire(String arm) {
        sink.record("ask", String.format(Locale.US, "arm=%s;pa=%s;pv=%s", arm,
                Double.isNaN(lastPa) ? "" : String.format(Locale.US, "%.3f", lastPa),
                Double.isNaN(lastPv) ? "" : String.format(Locale.US, "%.3f", lastPv)));
        sink.fire(arm, lastPa, lastPv);
    }

    // ---------- 저장 ----------
    private void savePlan() {
        store.put(KEY_PLAN, dayStart + ":" + planned[0] + "," + planned[1] + "," + planned[2]);
    }

    private long[] loadPlan(long today) {
        String s = store.get(KEY_PLAN);
        if (s == null) return null;
        try {
            String[] a = s.split(":");
            if (Long.parseLong(a[0]) != today) return null;
            String[] b = a[1].split(",");
            long[] t = new long[K];
            for (int i = 0; i < K; i++) t[i] = Long.parseLong(b[i]);
            return t;
        } catch (RuntimeException e) {
            return null;
        }
    }

    long startOfDay(long ms) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    long[] planned() { return planned.clone(); }
}
