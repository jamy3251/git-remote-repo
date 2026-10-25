package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public class TeacherContactTest {
    @Test
    public void teacherParsesAndLabels() throws IOException {
        TeacherRule t = TeacherRule.parse(new ByteArrayInputStream("theta_v 0.3\ntheta_a 0.5\nconf_min 0.4\n".getBytes(StandardCharsets.UTF_8)));
        assertEquals(0.3, t.thetaV, 0);
        // frames 100, faces 60 (rate 0.6), smile mean 0.35, jaw mean 0.1 → v=1, a=0 (0.45<0.5)
        assertArrayEquals(new int[]{1, 0}, t.label(new double[]{100, 60, 21.0, 6.0}));
        assertArrayEquals(new int[]{0, 1}, t.label(new double[]{100, 60, 12.0, 24.0}));  // smile .2, jaw .4 → a=1
        assertNull(t.label(new double[]{100, 30, 10.5, 3.0}));   // rate 0.3 < conf_min
        assertNull(t.label(new double[]{0, 0, 0, 0}));
        assertNull(t.label(null));
    }

    @Test(expected = IOException.class)
    public void teacherRejectsMissingThresholds() throws IOException {
        TeacherRule.parse(new ByteArrayInputStream("conf_min 0.3\n".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void contactRule() {
        assertFalse(ContactGate.contact(true, true, 0.0));     // 충전 중이면 비접촉
        assertTrue(ContactGate.contact(false, true, 1.0));     // 화면 켜짐이면 접촉
        assertTrue(ContactGate.contact(false, false, 0.5));    // 화면 꺼짐·움직임 있음 → 접촉
        assertFalse(ContactGate.contact(false, false, 0.95));  // 화면 꺼짐·1분 정지 → 비접촉
        assertFalse(ContactGate.contact(false, false, 0.9));   // 경계: ≥0.9 비접촉
    }
}
