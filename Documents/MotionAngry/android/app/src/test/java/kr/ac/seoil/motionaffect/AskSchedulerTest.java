package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.TimeZone;

public class AskSchedulerTest {
    static final TimeZone TZ = TimeZone.getTimeZone("Asia/Seoul");
    long now;
    final Map<Integer, Long> alarms = new HashMap<>();
    final Map<String, String> store = new HashMap<>();
    final List<String[]> records = new ArrayList<>();
    final List<String> fires = new ArrayList<>();
    AskScheduler s;

    long dayStart(long ms) {
        java.util.Calendar c = java.util.Calendar.getInstance(TZ);
        c.setTimeInMillis(ms);
        c.set(java.util.Calendar.HOUR_OF_DAY, 0); c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0); c.set(java.util.Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    @Before
    public void setUp() {
        // 2026-10-24 08:00 KST
        java.util.Calendar c = java.util.Calendar.getInstance(TZ);
        c.set(2026, java.util.Calendar.OCTOBER, 24, 8, 0, 0);
        c.set(java.util.Calendar.MILLISECOND, 0);
        now = c.getTimeInMillis();
        s = new AskScheduler(() -> now,
                new AskScheduler.Alarms() {
                    public void set(int idx, long at) { alarms.put(idx, at); }
                    public void cancel(int idx) { alarms.remove(idx); }
                },
                new AskScheduler.Store() {
                    public String get(String k) { return store.get(k); }
                    public void put(String k, String v) { store.put(k, v); }
                },
                new AskScheduler.Sink() {
                    public void record(String t, String v) { records.add(new String[]{t, v}); }
                    public void fire(String arm, double pa, double pv) { fires.add(arm); }
                }, new Random(7), TZ);
    }

    long count(String type) { return records.stream().filter(r -> r[0].equals(type)).count(); }

    @Test
    public void drawDay_threeTimesInWindowAtLeast30MinApart() {
        long d = dayStart(now);
        for (int seed = 0; seed < 50; seed++) {
            long[] t = AskScheduler.drawDay(d, new Random(seed));
            assertEquals(3, t.length);
            for (int i = 0; i < 3; i++) {
                assertTrue(t[i] >= d + 9 * 3_600_000L);
                assertTrue(t[i] < d + 23 * 3_600_000L);
            }
            for (int i = 1; i < 3; i++) assertTrue(t[i] - t[i - 1] >= AskScheduler.MIN_GAP_B_MS);
        }
    }

    @Test
    public void start_schedulesThreeFutureAlarmsAndMidnight_andRecordsAskSched() {
        s.start();
        assertEquals(3, count("ask_sched"));
        assertTrue(alarms.containsKey(0) && alarms.containsKey(1) && alarms.containsKey(2));
        assertEquals(dayStart(now) + 86_400_000L, (long) alarms.get(AskScheduler.IDX_MIDNIGHT));
        for (int i = 0; i < 3; i++) assertTrue(alarms.get(i) > now);
    }

    @Test
    public void restart_sameDay_reusesSavedPlan_noDuplicateAskSched() {
        s.start();
        long[] first = s.planned();
        records.clear();
        alarms.clear();
        now += 3_600_000L;  // 한 시간 뒤 프로세스 재시작
        setUpSchedulerWithSameStore();
        s.start();
        assertEquals(0, count("ask_sched"));
        long[] again = s.planned();
        for (int i = 0; i < 3; i++) assertEquals(first[i], again[i]);
        for (int i = 0; i < 3; i++) if (first[i] > now) assertEquals(first[i], (long) alarms.get(i));
    }

    private void setUpSchedulerWithSameStore() {
        s = new AskScheduler(() -> now,
                new AskScheduler.Alarms() {
                    public void set(int idx, long at) { alarms.put(idx, at); }
                    public void cancel(int idx) { alarms.remove(idx); }
                },
                new AskScheduler.Store() {
                    public String get(String k) { return store.get(k); }
                    public void put(String k, String v) { store.put(k, v); }
                },
                new AskScheduler.Sink() {
                    public void record(String t, String v) { records.add(new String[]{t, v}); }
                    public void fire(String arm, double pa, double pv) { fires.add(arm); }
                }, new Random(99), TZ);
    }

    @Test
    public void midnightAlarm_drawsNextDayPlan() {
        s.start();
        long[] first = s.planned();
        now = dayStart(now) + 86_400_000L + 1000;  // 다음 날 00:00:01
        records.clear();
        s.onAlarm(AskScheduler.IDX_MIDNIGHT);
        assertEquals(3, count("ask_sched"));
        long[] next = s.planned();
        for (int i = 0; i < 3; i++) assertTrue(next[i] >= dayStart(now) + 9 * 3_600_000L);
        assertFalse(first[0] == next[0] && first[1] == next[1] && first[2] == next[2]);
        assertEquals(dayStart(now) + 86_400_000L, (long) alarms.get(AskScheduler.IDX_MIDNIGHT));
    }

    @Test
    public void armB_fires_withArmRecorded_andNoEstimateYet() {
        s.start();
        now = alarms.get(0);
        s.onAlarm(0);
        assertEquals(1, fires.size());
        assertEquals("B", fires.get(0));
        String[] last = records.get(records.size() - 1);
        assertEquals("ask", last[0]);
        assertTrue(last[1].startsWith("arm=B;pa=;pv="));
    }

    @Test
    public void armB_postponed15Min_whenArmAFiredJustBefore() {
        s.start();
        now = alarms.get(0) - 5 * 60_000L;
        s.onEstimate(0.30, 0.5);          // 기준 설정
        now += 60_000L;
        s.onEstimate(0.30, 0.5);
        now += 31 * 60_000L;              // 30분 경과 후 급변 → 팔 A 발화
        s.onEstimate(0.70, 0.5);
        assertEquals(List.of("A"), fires);
        long bAt = now + 60_000L;         // 1분 뒤 B 알람
        now = bAt;
        s.onAlarm(1);
        assertEquals(1, fires.size());    // 미룸
        assertEquals(1, count("ask_delay"));
        assertEquals(now + AskScheduler.MIN_GAP_AB_MS, (long) alarms.get(1));
        now = alarms.get(1);
        s.onAlarm(1);
        assertEquals(List.of("A", "B"), fires);
    }

    @Test
    public void armA_unchanged_deltaAndGap() {
        s.start();
        s.onEstimate(0.40, 0.5);          // 첫 추정은 기준만 잡음
        now += 31 * 60_000L;
        s.onEstimate(0.60, 0.5);          // |Δ|=0.20 < 0.25 → 없음
        assertEquals(0, fires.size());
        s.onEstimate(0.70, 0.5);          // |Δ|=0.30, 30분 경과 → 발화
        assertEquals(List.of("A"), fires);
        now += 10 * 60_000L;
        s.onEstimate(0.20, 0.5);          // 10분 뒤 → 간격 미달
        assertEquals(1, fires.size());
        String[] ask = records.stream().filter(r -> r[0].equals("ask")).findFirst().get();
        assertTrue(ask[1].startsWith("arm=A;pa=0.700;pv=0.500"));
    }

    @Test
    public void loadPlan_ignoresOtherDayOrCorrupt() {
        store.put("askB.plan", "123:1,2,3");
        s.start();
        assertEquals(3, count("ask_sched"));  // 다른 날 계획은 무시하고 새로 뽑음
        store.put("askB.plan", "garbage");
        records.clear();
        setUpSchedulerWithSameStore();
        s.start();
        assertEquals(3, count("ask_sched"));
        assertNull(null);
    }
}
