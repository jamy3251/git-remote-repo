package kr.ac.seoil.motionaffect;

import android.content.Context;

import org.tensorflow.lite.Interpreter;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 단말 내 학생 학습(설계 2단계, D2/R10): assets/head.tflite(32개 요약 특징 표준화 + 로지스틱, train/infer/get_weights/set_weights)
 * 한 과제(각성 또는 정서가)에 한 인스턴스. 교사 라벨이 붙은 분(특징 32 + 라벨)을 모아 두었다가 train(steps)로 SGD를 돌린다.
 * 가중치는 get_weights로 읽어 StudentModel 텍스트(files/models/student_<task>.txt)로 저장하고, 시작 시 그 파일이 있으면
 * set_weights로 되돌린다(체크포인트 대용; save/restore 시그니처는 flex 위임이 필요해 쓰지 않음).
 * 표준화 상수 mu/sd는 모델 안의 K-EmoPhone 통계(학생이 배우는 것은 w, b).
 */
final class OnDeviceTrainer {
    static final int MIN_SAMPLES = 50;     // 이보다 적으면 학습하지 않음
    static final int MAX_SAMPLES = 2000;   // 최근 n개만 보관(약 33시간치 분)
    static final int STEPS = 100;

    final String task;
    private final String[] names;
    private final Interpreter it;
    private final ArrayDeque<float[]> xs = new ArrayDeque<>();
    private final ArrayDeque<Float> ys = new ArrayDeque<>();
    private final float[] mu = new float[32], sd = new float[32];
    int trained;   // 누적 학습 스텝

    OnDeviceTrainer(Context ctx, String task) throws IOException {
        this.task = task;
        List<String> n = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(ctx.getAssets().open("head_features.txt")))) {
            String line;
            while ((line = r.readLine()) != null) if (!line.isEmpty()) n.add(line.trim());
        }
        names = n.toArray(new String[0]);
        MappedByteBuffer model;
        try (android.content.res.AssetFileDescriptor fd = ctx.getAssets().openFd("head.tflite");
             FileInputStream in = new FileInputStream(fd.getFileDescriptor())) {
            model = in.getChannel().map(FileChannel.MapMode.READ_ONLY, fd.getStartOffset(), fd.getDeclaredLength());
        }
        Interpreter.Options opt = new Interpreter.Options();
        opt.setNumThreads(1);
        it = new Interpreter(model, opt);
        readWeights();  // mu/sd 채우기
        File saved = new File(new File(ctx.getExternalFilesDir(null), ModelFiles.DIR), "student_" + task + ".txt");
        boolean restored = false;
        if (saved.exists()) {
            try (FileInputStream in = new FileInputStream(saved)) {
                restore(new StudentModelText(in));
                restored = true;
                source = "files";
            } catch (Exception ignored) {
                // 손상 파일은 무시하고 씨앗으로 시작
            }
        }
        if (!restored) {
            // 저장 파일이 없으면 assets의 씨앗 가중치(공개 데이터 전체로 배운 로지스틱, export_daily --student)로 시작.
            // 2026-10-25 수정: 이전에는 0으로 시작해 첫 저장이 0을 덮어써 학생 확률이 항상 0.5였음.
            try (java.io.InputStream in = ctx.getAssets().open("student_" + task + ".txt")) {
                restore(new StudentModelText(in));
                source = "assets";
            } catch (Exception ignored) {
                source = "zero";
            }
        }
    }

    /** 시작 가중치 출처: files(저장 파일) / assets(씨앗) / zero. */
    String source = "zero";

    float[] vector(Map<String, Double> summary) {
        float[] x = new float[names.length];
        for (int i = 0; i < x.length; i++) {
            Double v = summary.get(names[i]);
            if (v == null || v.isNaN()) return null;
            x[i] = v.floatValue();
        }
        return x;
    }

    /** 교사 라벨이 붙은 분을 보관. */
    void add(float[] x, int label) {
        if (x == null) return;
        xs.addLast(x);
        ys.addLast((float) label);
        while (xs.size() > MAX_SAMPLES) { xs.pollFirst(); ys.pollFirst(); }
    }

    int samples() { return xs.size(); }

    /** 보관한 표본 전체로 STEPS 스텝 SGD. 표본이 부족하면 -1, 아니면 마지막 손실. */
    double train() {
        if (xs.size() < MIN_SAMPLES) return -1;
        float[][] x = xs.toArray(new float[0][]);
        float[][] y = new float[x.length][1];
        int i = 0;
        for (float v : ys) y[i++][0] = v;
        Map<String, Object> in = new HashMap<>();
        in.put("x", x);
        in.put("y", y);
        java.nio.FloatBuffer loss = java.nio.FloatBuffer.allocate(1);
        Map<String, Object> out = new HashMap<>();
        out.put("loss", loss);
        double last = Double.NaN;
        for (int s = 0; s < STEPS; s++) {
            loss.rewind();
            it.runSignature(in, out, "train");
            last = loss.get(0);
        }
        trained += STEPS;
        return last;
    }

    double predict(float[] x) {
        float[][] p = new float[1][1];
        Map<String, Object> in = new HashMap<>();
        in.put("x", new float[][]{x});
        Map<String, Object> out = new HashMap<>();
        out.put("p", p);
        it.runSignature(in, out, "infer");
        return p[0][0];
    }

    private float[] w = new float[32];
    private float[] b = new float[1];

    private void readWeights() {
        Map<String, Object> out = new HashMap<>();
        out.put("w", w);
        out.put("b", b);
        out.put("mu", mu);
        out.put("sd", sd);
        Map<String, Object> in = new HashMap<>();
        in.put("dummy", new float[]{0f});  // 빈 입력은 거부되므로 더미
        it.runSignature(in, out, "get_weights");
    }

    private void restore(StudentModelText t) {
        if (t.w.length != 32) return;
        Map<String, Object> in = new HashMap<>();
        in.put("w", t.w);
        in.put("b", t.b);
        Map<String, Object> out = new HashMap<>();
        out.put("ok", java.nio.FloatBuffer.allocate(1));
        it.runSignature(in, out, "set_weights");
    }

    /** StudentModel.java가 읽는 텍스트 형식으로 저장(mu/sd 포함). */
    void save(Context ctx) throws IOException {
        readWeights();
        File dir = new File(ctx.getExternalFilesDir(null), ModelFiles.DIR);
        dir.mkdirs();
        StringBuilder sb = new StringBuilder("logistic 32 ").append(String.join(" ", names)).append('\n');
        sb.append("mu"); for (float v : mu) sb.append(' ').append(String.format(Locale.US, "%.9g", v)); sb.append('\n');
        sb.append("sd"); for (float v : sd) sb.append(' ').append(String.format(Locale.US, "%.9g", v)); sb.append('\n');
        sb.append("w"); for (float v : w) sb.append(' ').append(String.format(Locale.US, "%.9g", v)); sb.append('\n');
        sb.append("b ").append(String.format(Locale.US, "%.9g", b[0])).append('\n');
        try (java.io.FileWriter fw = new java.io.FileWriter(new File(dir, "student_" + task + ".txt"))) {
            fw.write(sb.toString());
        }
    }

    void close() { it.close(); }

    /** 저장 파일의 w,b만 읽는 작은 파서(StudentModel과 같은 형식). */
    static final class StudentModelText {
        final float[] w;
        final float[] b = new float[1];
        StudentModelText(java.io.InputStream in) throws IOException {
            BufferedReader r = new BufferedReader(new InputStreamReader(in));
            String[] h = r.readLine().split(" ");
            int n = Integer.parseInt(h[1]);
            r.readLine(); r.readLine();  // mu, sd (모델 상수와 같다고 가정)
            String[] wl = r.readLine().split(" ");
            w = new float[n];
            for (int i = 0; i < n; i++) w[i] = (float) Fixtures.parseDouble(wl[i + 1]);
            b[0] = (float) Fixtures.parseDouble(r.readLine().split(" ")[1]);
        }
    }

    static String describe(OnDeviceTrainer t) {
        if (t == null) return "none";
        t.readWeights();  // set_weights 뒤의 실제 가중치를 읽어 기록
        return String.format(Locale.US, "task=%s samples=%d steps=%d w0=%.4f b=%.4f source=%s", t.task, t.samples(), t.trained, t.w[0], t.b[0], t.source);
    }

    static boolean sameOrder(String[] a, String[] b) { return Arrays.equals(a, b); }
}
