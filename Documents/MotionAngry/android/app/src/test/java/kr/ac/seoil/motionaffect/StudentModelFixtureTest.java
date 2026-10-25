package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.io.FileInputStream;
import java.nio.file.Files;
import java.util.List;

/** export_daily.py --student 가 쓴 씨앗 학생 모델과 픽스처가 Java 계산과 1e-9 안에서 일치하는지. */
public class StudentModelFixtureTest {
    static File assets() {
        File f = new File("src/main/assets");
        if (!f.isDirectory()) f = new File("app/src/main/assets");
        assertTrue("assets dir not found from " + new File(".").getAbsolutePath(), f.isDirectory());
        return f;
    }

    @Test
    public void seedModelsMatchPythonFixture() throws Exception {
        File a = assets();
        List<String> fx = Files.readAllLines(new File(a, "selftest_student.txt").toPath());
        for (String task : new String[]{"arousal", "valence"}) {
            StudentModel m;
            try (FileInputStream in = new FileInputStream(new File(a, "student_" + task + ".txt"))) {
                m = new StudentModel(in);
            }
            assertEquals(32, m.features.length);
            int checked = 0;
            for (int i = 1; i < fx.size(); i += 2) {
                if (!fx.get(i).startsWith("feat_" + task + " ")) continue;
                String[] f = fx.get(i).split(" ");
                double[] x = new double[f.length - 1];
                for (int j = 0; j < x.length; j++) x[j] = Fixtures.parseDouble(f[j + 1]);
                double expected = Fixtures.parseDouble(fx.get(i + 1).split(" ")[1]);
                assertEquals(expected, m.predict(x), 1e-9);
                checked++;
            }
            assertEquals(3, checked);
        }
    }
}
