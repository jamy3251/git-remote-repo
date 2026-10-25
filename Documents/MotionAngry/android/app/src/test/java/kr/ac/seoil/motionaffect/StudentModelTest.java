package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class StudentModelTest {
    static StudentModel of(String text) throws IOException {
        return new StudentModel(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void predictMatchesStandardizedLogistic() throws IOException {
        StudentModel m = of("logistic 2 a b\nmu 1.0 2.0\nsd 2.0 0\nw 0.5 -1.0\nb 0.1\n");
        Map<String, Double> f = new HashMap<>();
        f.put("a", 3.0);   // z = 1.0
        f.put("b", 2.5);   // sd 0 → 1, z = 0.5
        double s = 0.1 + 0.5 * 1.0 + (-1.0) * 0.5;
        assertEquals(1 / (1 + Math.exp(-s)), m.predict(m.vector(f)), 1e-12);
    }

    @Test
    public void corruptFilesThrowIOException_notCrashLater() {
        String[] bad = {"", "tree 2 a b\n", "logistic 2 a b\nmu 1 nan\nsd 1 1\nw 1 1\nb 0\n",
                "logistic 2 a b\nmu 1 2\nsd 1 1\nw 1\nb 0\n", "logistic 2 a b\nmu 1 2\nsd 1 1\nw 1 1\n"};
        for (String t : bad) {
            try {
                of(t);
                fail("expected failure for: " + t.replace('\n', '|'));
            } catch (IOException | RuntimeException expected) {
                // ModelFiles가 잡아 assets로 폴백한다
            }
        }
    }
}
