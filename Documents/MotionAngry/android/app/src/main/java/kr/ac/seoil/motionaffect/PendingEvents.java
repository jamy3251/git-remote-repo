package kr.ac.seoil.motionaffect;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Locale;

/**
 * 서비스가 꺼져 있을 때 들어온 좋아/별로·격자 입력을 잃지 않는다(설계 Section 2 Q4).
 * events.csv와 같은 열(t_ns,wall_ms,type,app,media,value)로 pending_events.csv에 쌓았다가,
 * 서비스가 시작해 events.csv를 열면 그 뒤에 붙이고 pending 파일을 지운다.
 */
final class PendingEvents {
    static final String FILE = "pending_events.csv";

    private PendingEvents() {}

    static void append(File dir, long tNs, long wallMs, String type, String value) throws IOException {
        dir.mkdirs();
        try (BufferedWriter w = new BufferedWriter(new FileWriter(new File(dir, FILE), true))) {
            w.write(String.format(Locale.US, "%d,%d,%s,,,%s\n", tNs, wallMs, type, value == null ? "" : value));
        }
    }

    /** pending 행을 events에 붙이고 파일을 지운다. 붙인 행 수를 돌려준다. */
    static int drainInto(File dir, BufferedWriter events) throws IOException {
        File f = new File(dir, FILE);
        if (!f.exists()) return 0;
        int n = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) continue;
                events.write(line);
                events.write('\n');
                n++;
            }
        }
        events.flush();
        if (!f.delete()) f.deleteOnExit();
        return n;
    }
}
