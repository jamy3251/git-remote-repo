package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

public class AffectRowTest {
    static double[][] window(long seed) {
        java.util.Random r = new java.util.Random(seed);
        double[][] w = new double[480][3];
        for (int i = 0; i < 480; i++) {
            w[i][0] = 0.3 + 0.02 * r.nextGaussian();
            w[i][1] = 0.1 * r.nextGaussian();
            w[i][2] = 0.95 + 0.02 * r.nextGaussian();
        }
        return w;
    }

    @Test
    public void headerAndRowsHaveSameColumnCount_withAndWithoutMissing() {
        Map<String, Double> m = Features.compute(DailyEngine.block4(window(1)), 2);
        List<String> keys = AffectRow.keys(m);
        assertEquals(16, keys.size());
        String header = AffectRow.header(keys);
        int cols = AffectRow.columns(keys);
        assertEquals(cols, header.trim().split(",", -1).length);
        assertEquals(8 + 8 + 48 + 3, cols);

        List<Map<String, Double>> per = new ArrayList<>();
        for (int i = 0; i < 6; i++) per.add(Features.compute(DailyEngine.block4(window(10 + i)), 2));
        Map<String, Double> summary = DailyEngine.summarize(per);
        double[] posture = PostureRule.classify(window(1), true);

        String full = AffectRow.row(1L, 2L, 6, new double[]{0.61, 0.52}, 220, 260, "com.iloen.melon",
                true, posture, new double[]{120, 90, 30.0, 4.5}, m, summary, keys);
        assertEquals(cols, full.trim().split(",", -1).length);
        assertTrue(full.contains(",3,1,"));  // v=3, screen_on=1

        String missing = AffectRow.row(1L, 2L, 2, null, 220, 0, "a,b", false, posture, new double[]{0, 0, 0, 0}, m, null, keys);
        String[] cells = missing.trim().split(",", -1);
        assertEquals(cols, cells.length);
        assertEquals("", cells[3]);          // p_arousal 빈 값
        assertEquals("a_b", cells[7]);       // 앱 이름의 쉼표 치환
        assertEquals("0", cells[12]);        // face_frames 0
        assertEquals("", cells[13]);         // face_rate 빈 값
        assertEquals("", cells[cols - 1]);   // contact 빈 값
        assertEquals("", cells[cols - 4]);   // 요약 빈 값
        String withStudent = AffectRow.row(1L, 2L, 6, new double[]{0.6, 0.5}, 1, 1, "a", true, posture, null, m, summary, keys,
                new double[]{0.71, Double.NaN}, 1);
        String[] c2 = withStudent.trim().split(",", -1);
        assertEquals(cols, c2.length);
        assertEquals("0.7100", c2[cols - 3]);
        assertEquals("", c2[cols - 2]);
        assertEquals("1", c2[cols - 1]);
    }

    @Test
    public void keysAreSortedAndStable() {
        Map<String, Double> m = Features.compute(DailyEngine.block4(window(3)), 2);
        List<String> k1 = AffectRow.keys(m);
        List<String> sorted = new ArrayList<>(k1);
        sorted.sort(null);
        assertEquals(sorted, k1);
        assertEquals(k1, AffectRow.keys(Features.compute(DailyEngine.block4(window(4)), 2)));
        assertTrue(Arrays.asList(AffectRow.EXTRA).contains("held"));
    }
}
