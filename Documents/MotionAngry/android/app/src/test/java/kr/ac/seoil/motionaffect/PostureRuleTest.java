package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Random;

public class PostureRuleTest {
    /** 평균 중력 방향(기울기 각도)과 흔들림 크기로 8Hz 60초 창을 만든다. */
    static double[][] win(double tiltDeg, double jitterG, long seed) {
        Random r = new Random(seed);
        double t = Math.toRadians(tiltDeg);
        double[][] w = new double[480][3];
        for (int i = 0; i < 480; i++) {
            double j = jitterG * (r.nextDouble() * 2 - 1);  // 크기 방향 흔들림
            double g = 1.0 + j;
            w[i][0] = g * Math.sin(t);
            w[i][1] = 0;
            w[i][2] = g * Math.cos(t);
        }
        return w;
    }

    @Test
    public void flatOnDesk() {
        double[] r = PostureRule.classify(win(3, 0.001, 1), false);
        assertTrue(r[0] < PostureRule.TILT_MIN_DEG);
        assertEquals(PostureRule.FLAT, (int) r[2]);
    }

    @Test
    public void heldInHand_screenOn() {
        double[] r = PostureRule.classify(win(45, 0.05, 2), true);
        assertEquals(45, r[0], 1.0);
        assertTrue(r[1] > PostureRule.STD_MIN_G);
        assertEquals(PostureRule.HELD, (int) r[2]);
    }

    @Test
    public void tiltedButScreenOff_isOther() {
        double[] r = PostureRule.classify(win(45, 0.05, 3), false);
        assertEquals(PostureRule.OTHER, (int) r[2]);
    }

    @Test
    public void proppedUpStill_isOther_notHeld() {
        // 세워 두고 봄: 화면 켜짐·기울어짐·하지만 흔들림 없음 → other
        double[] r = PostureRule.classify(win(60, 0.0005, 4), true);
        assertEquals(PostureRule.OTHER, (int) r[2]);
    }

    @Test
    public void boundaries_15and80deg() {
        assertEquals(PostureRule.HELD, (int) PostureRule.classify(win(15.5, 0.05, 5), true)[2]);
        assertEquals(PostureRule.OTHER, (int) PostureRule.classify(win(14.0, 0.05, 6), true)[2]);  // 기울기 미달 + 흔들림 → other
        assertEquals(PostureRule.HELD, (int) PostureRule.classify(win(79.5, 0.05, 7), true)[2]);
        assertEquals(PostureRule.OTHER, (int) PostureRule.classify(win(81.0, 0.05, 8), true)[2]);
    }

    @Test
    public void emptyWindow() {
        double[] r = PostureRule.classify(null, true);
        assertTrue(Double.isNaN(r[0]));
        assertEquals(PostureRule.OTHER, (int) r[2]);
    }
}
