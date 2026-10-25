package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class DriftGuardTest {
    final List<String> rec = new ArrayList<>();
    final DriftGuard.Sink sink = (t, v) -> rec.add(t + ":" + v);

    @Test
    public void holdsBelowMinN() {
        DriftGuard g = new DriftGuard(sink, true);
        for (int i = 0; i < DriftGuard.MIN_N - 1; i++) g.score(i * 3_600_000L, 1, 0.9, 0.1);  // 학생 전부 오답
        assertTrue(g.studentActive());
        assertEquals(0, rec.size());
    }

    @Test
    public void rollsBackThenReappliesWithHysteresis() {
        DriftGuard g = new DriftGuard(sink, true);
        long t = 0;
        // 15개: 출하 정답 15/15, 학생 정답 12/15 → 차 0.2 > 0.10 → 복귀
        for (int i = 0; i < 15; i++, t += 3_600_000L) g.score(t, 1, 0.9, i < 12 ? 0.9 : 0.1);
        assertFalse(g.studentActive());
        assertEquals(1, rec.size());
        assertTrue(rec.get(0).startsWith("guard:to=ship;n=15"));
        // 이후 학생이 조금 나아져도(+0.04) 재적용 안 함: 창 안 15개 중 출하 11, 학생 11+? 구성
        g = new DriftGuard(sink, false);
        rec.clear();
        t = 0;
        for (int i = 0; i < 20; i++, t += 3_600_000L) g.score(t, 1, i < 14 ? 0.9 : 0.1, i < 15 ? 0.9 : 0.1);  // ship .70, student .75 → +0.05 → 재적용
        assertTrue(g.studentActive());
        assertTrue(rec.get(0).startsWith("guard:to=student"));
    }

    @Test
    public void windowDropsOldHits() {
        DriftGuard g = new DriftGuard(sink, true);
        for (int i = 0; i < 14; i++) g.score(i * 1000L, 1, 0.9, 0.1);   // 오래된 오답 14개
        g.score(DriftGuard.WINDOW_MS + 100_000L, 1, 0.9, 0.9);        // 14일 뒤 → 창에서 옛것 제거
        assertEquals(1, g.n());
        assertTrue(g.studentActive());
    }

    @Test
    public void nanProbabilitiesIgnored() {
        DriftGuard g = new DriftGuard(sink, true);
        g.score(0, 1, Double.NaN, 0.9);
        assertEquals(0, g.n());
    }
}
