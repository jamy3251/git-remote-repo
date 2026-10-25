package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class FixturesParseTest {
    @Test
    public void nanTokensBecomeNaN() {
        assertTrue(Double.isNaN(Fixtures.parseDouble("nan")));
        assertTrue(Double.isNaN(Fixtures.parseDouble("NaN")));
        assertTrue(Double.isNaN(Fixtures.parseDouble("")));
        assertTrue(Double.isNaN(Fixtures.parseDouble("  ")));
        assertTrue(Double.isNaN(Fixtures.parseDouble(null)));
        assertTrue(Double.isNaN(Fixtures.parseDouble("null")));
    }

    @Test
    public void numbersParse() {
        assertEquals(0.5, Fixtures.parseDouble("0.5"), 0);
        assertEquals(-1e-3, Fixtures.parseDouble(" -1e-3 "), 0);
    }

    @Test(expected = NumberFormatException.class)
    public void garbageStillThrows() {
        Fixtures.parseDouble("abc");
    }
}
