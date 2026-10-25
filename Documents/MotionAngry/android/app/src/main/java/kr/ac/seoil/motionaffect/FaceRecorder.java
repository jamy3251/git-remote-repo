package kr.ac.seoil.motionaffect;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.util.Log;
import android.util.Size;

import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * 앞카메라 프레임에서 MediaPipe Face Landmarker로 표정 계수(blendshape 52개)만 뽑아 기록한다.
 * 카메라 영상·얼굴 이미지는 저장하지 않는다. 초당 fps장으로 제한.
 * 출력 열: t_ns(elapsedRealtime),phase,clip,infer_ms,face,bs0..bs51 (이름은 _face_names.txt)
 */
final class FaceRecorder {
    private final Context ctx;
    private final int fps;
    private final Supplier<String> tag;
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private FaceLandmarker landmarker;
    private BufferedWriter out;
    private File namesFile;
    private long lastMs, frames, faces;
    // affect.csv v2용 분 집계: {frames, faces, smile 합, jawOpen 합}. drainMinute()로 읽고 비운다.
    private final double[] agg = new double[4];
    private int idxSmileL = -1, idxSmileR = -1, idxJaw = -1;
    private ProcessCameraProvider provider;

    /** tag: 현재 "phase,clip" 문자열 */
    FaceRecorder(Context ctx, File csv, int fps, Supplier<String> tag) throws IOException {
        this.ctx = ctx;
        this.fps = fps;
        this.tag = tag;
        out = new BufferedWriter(new FileWriter(csv));
        StringBuilder h = new StringBuilder("t_ns,phase,clip,infer_ms,face");
        for (int i = 0; i < 52; i++) h.append(",bs").append(i);
        out.write(h.append('\n').toString());
        namesFile = new File(csv.getParentFile(), csv.getName().replace(".csv", "_names.txt"));
        landmarker = FaceLandmarker.createFromOptions(ctx, FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("face_landmarker.task").build())
                .setRunningMode(RunningMode.VIDEO)
                .setNumFaces(1)
                .setOutputFaceBlendshapes(true)
                .build());
    }

    void start(LifecycleOwner owner) {
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(ctx);
        f.addListener(() -> {
            try {
                provider = f.get();
                ImageAnalysis ia = new ImageAnalysis.Builder()
                        .setTargetResolution(new Size(480, 640))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                        .build();
                ia.setAnalyzer(exec, this::analyze);
                provider.unbindAll();
                provider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, ia);
            } catch (Exception e) {
                Log.e(MainActivity.TAG, "camera start failed", e);
            }
        }, ContextCompat.getMainExecutor(ctx));
    }

    private void analyze(ImageProxy img) {
        try {
            long nowMs = SystemClock.uptimeMillis();
            if (nowMs - lastMs < 1000 / fps || out == null) return;
            lastMs = nowMs;
            long tNs = SystemClock.elapsedRealtimeNanos();
            Bitmap bmp = img.toBitmap();
            ImageProcessingOptions opt = ImageProcessingOptions.builder()
                    .setRotationDegrees(img.getImageInfo().getRotationDegrees()).build();
            long a = System.nanoTime();
            FaceLandmarkerResult r = landmarker.detectForVideo(new BitmapImageBuilder(bmp).build(), opt, nowMs);
            double ms = (System.nanoTime() - a) / 1e6;
            StringBuilder s = new StringBuilder(String.format(Locale.US, "%d,%s,%.1f", tNs, tag.get(), ms));
            List<List<Category>> bs = r.faceBlendshapes().orElse(null);
            if (bs == null || bs.isEmpty()) {
                s.append(",0");
                for (int i = 0; i < 52; i++) s.append(',');
            } else {
                List<Category> c = bs.get(0);
                if (namesFile != null) writeNames(c);
                if (idxJaw == -1) findIndices(c);
                synchronized (agg) {
                    agg[1] += 1;
                    if (idxSmileL >= 0 && idxSmileR >= 0)
                        agg[2] += (c.get(idxSmileL).score() + c.get(idxSmileR).score()) / 2.0;
                    if (idxJaw >= 0) agg[3] += c.get(idxJaw).score();
                }
                s.append(",1");
                for (int i = 0; i < 52; i++) s.append(i < c.size() ? String.format(Locale.US, ",%.4f", c.get(i).score()) : ",");
                faces++;
            }
            synchronized (agg) { agg[0] += 1; }
            out.write(s.append('\n').toString());
            if (++frames % 20 == 0) {
                out.flush();
                Log.i(MainActivity.TAG, String.format(Locale.US, "face frames=%d detected=%d infer_ms=%.0f", frames, faces, ms));
            }
        } catch (Exception e) {
            Log.e(MainActivity.TAG, "face frame failed", e);
        } finally {
            img.close();
        }
    }

    private void findIndices(List<Category> c) {
        for (int i = 0; i < c.size(); i++) {
            String n = c.get(i).categoryName();
            if ("mouthSmileLeft".equals(n)) idxSmileL = i;
            else if ("mouthSmileRight".equals(n)) idxSmileR = i;
            else if ("jawOpen".equals(n)) idxJaw = i;
        }
        if (idxJaw < 0) idxJaw = -2;  // 이름을 못 찾으면 다시 찾지 않음
    }

    /** 지난 분의 집계를 돌려주고 비운다. {frames, faces, smileSum, jawSum} */
    double[] drainMinute() {
        synchronized (agg) {
            double[] out = agg.clone();
            java.util.Arrays.fill(agg, 0);
            return out;
        }
    }

    private void writeNames(List<Category> c) {
        try (FileWriter w = new FileWriter(namesFile)) {
            for (int i = 0; i < c.size(); i++) w.write(i + " " + c.get(i).categoryName() + "\n");
        } catch (IOException ignored) {
        }
        namesFile = null;
    }

    void stop() {
        if (provider != null) provider.unbindAll();
        exec.execute(() -> {
            try {
                if (out != null) out.close();
            } catch (IOException ignored) {
            }
            out = null;
            if (landmarker != null) landmarker.close();
            landmarker = null;
        });
        exec.shutdown();
    }
}
