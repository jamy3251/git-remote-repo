package kr.ac.seoil.motionaffect;

import android.content.Context;
import android.os.Debug;

import org.tensorflow.lite.Interpreter;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * T11 (설계 R10): LiteRT 온디바이스 학습 1일 프로브.
 * assets/head.tflite(32→1 로지스틱, train/infer 시그니처)를 표준 TFLite 런타임으로 열고,
 * assets/probe_head.txt의 고정 배치(64×32)로 100 스텝 학습 → 시간·메모리, 처음 8개 샘플 확률을 Python 기준과 비교한다.
 * 실패 기준(D11): 로드 실패 / 런타임 충돌 / 100스텝 > 5초 / 피크 메모리 > 100MB / |Δp| > 1e-4.
 */
final class LiteRTProbe {
    static String run(Context ctx) {
        StringBuilder out = new StringBuilder();
        long t0 = System.nanoTime();
        try {
            // 픽스처
            int batch = 0, feats = 0, steps = 0;
            float[][] x = null;
            float[][] y = null;
            double[] p8 = null;
            double lossFinal = Double.NaN;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(ctx.getAssets().open("probe_head.txt")))) {
                String[] h = r.readLine().split(" ");
                batch = Integer.parseInt(h[1]); feats = Integer.parseInt(h[3]); steps = Integer.parseInt(h[5]);
                x = new float[batch][feats];
                y = new float[batch][1];
                String line;
                int i = 0;
                while ((line = r.readLine()) != null) {
                    String[] p = line.split(" ");
                    if (p[0].equals("x")) {
                        for (int k = 0; k < feats; k++) x[i][k] = (float) Fixtures.parseDouble(p[k + 1]);
                        y[i][0] = (float) Fixtures.parseDouble(p[feats + 2]);
                        i++;
                    } else if (p[0].equals("p8")) {
                        p8 = new double[p.length - 1];
                        for (int k = 0; k < p8.length; k++) p8[k] = Fixtures.parseDouble(p[k + 1]);
                    } else if (p[0].equals("loss_final")) {
                        lossFinal = Fixtures.parseDouble(p[1]);
                    }
                }
            }
            long memBefore = Debug.getNativeHeapAllocatedSize() + Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();

            // 모델 로드 (파일 디스크립터 매핑)
            long tl0 = System.nanoTime();
            MappedByteBuffer model;
            try (android.content.res.AssetFileDescriptor fd = ctx.getAssets().openFd("head.tflite");
                 FileInputStream in = new FileInputStream(fd.getFileDescriptor())) {
                model = in.getChannel().map(FileChannel.MapMode.READ_ONLY, fd.getStartOffset(), fd.getDeclaredLength());
            }
            Interpreter.Options opt = new Interpreter.Options();
            opt.setNumThreads(1);
            Interpreter it = new Interpreter(model, opt);
            double loadMs = (System.nanoTime() - tl0) / 1e6;
            out.append(String.format(Locale.US, "signatures=%s\n", Arrays.toString(it.getSignatureKeys())));

            // 학습 100 스텝
            Map<String, Object> in = new HashMap<>();
            in.put("x", x);
            in.put("y", y);
            java.nio.FloatBuffer loss = java.nio.FloatBuffer.allocate(1);  // 스칼라 출력(shape [])
            Map<String, Object> o = new HashMap<>();
            o.put("loss", loss);
            double firstLoss = Double.NaN, lastLoss = Double.NaN;
            long ttr0 = System.nanoTime();
            for (int s = 0; s < steps; s++) {
                loss.rewind();
                it.runSignature(in, o, "train");
                if (s == 0) firstLoss = loss.get(0);
                lastLoss = loss.get(0);
            }
            double trainMs = (System.nanoTime() - ttr0) / 1e6;

            // 추론·비교
            float[][] x8 = Arrays.copyOfRange(x, 0, 8);
            float[][] p = new float[8][1];
            Map<String, Object> in2 = new HashMap<>();
            in2.put("x", x8);
            Map<String, Object> o2 = new HashMap<>();
            o2.put("p", p);
            long ti0 = System.nanoTime();
            it.runSignature(in2, o2, "infer");
            double inferUs = (System.nanoTime() - ti0) / 1e3;
            double maxDp = 0;
            for (int k = 0; k < 8; k++) maxDp = Math.max(maxDp, Math.abs(p[k][0] - p8[k]));
            long memAfter = Debug.getNativeHeapAllocatedSize() + Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
            it.close();

            boolean pass = trainMs <= 5000 && (memAfter - memBefore) <= 100L * 1024 * 1024 && maxDp <= 1e-4;
            out.append(String.format(Locale.US,
                    "model_bytes=%d load_ms=%.1f train_%d_steps_ms=%.1f per_step_us=%.0f infer_8_us=%.0f "
                            + "loss_first=%.6f(py %.6f) loss_last=%.6f(py %.6f) max_dp=%.2e mem_delta_MB=%.1f total_ms=%.0f RESULT=%s\n",
                    model.capacity(), loadMs, steps, trainMs, trainMs * 1000 / steps, inferUs, firstLoss, Double.NaN, lastLoss,
                    lossFinal, maxDp, (memAfter - memBefore) / 1048576.0, (System.nanoTime() - t0) / 1e6, pass ? "PASS" : "FAIL"));
        } catch (Throwable e) {
            out.append("RESULT=FAIL error=").append(e.getClass().getName()).append(": ").append(String.valueOf(e.getMessage())).append('\n');
        }
        return out.toString();
    }
}
