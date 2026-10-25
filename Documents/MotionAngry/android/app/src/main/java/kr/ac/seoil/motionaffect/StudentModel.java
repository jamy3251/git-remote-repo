package kr.ac.seoil.motionaffect;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Map;

/**
 * 학생 모델(설계 R4(d)): 32개 요약 특징을 표준화한 뒤 로지스틱. src/s7_cumulative.py own_model과 같은 계산
 * (StandardScaler + LogisticRegression). 파일 형식(텍스트, 공백 구분):
 *   logistic N name_1 ... name_N
 *   mu v_1 ... v_N
 *   sd v_1 ... v_N
 *   w  v_1 ... v_N
 *   b  v
 * 확률 = sigmoid(Σ w_i (x_i − mu_i)/sd_i + b). sd가 0이면 1로 둔다(상수 특징).
 */
final class StudentModel {
    final String[] features;
    private final double[] mu, sd, w;
    private final double b;

    StudentModel(InputStream in) throws IOException {
        BufferedReader r = new BufferedReader(new InputStreamReader(in));
        String[] h = r.readLine().split(" ");
        if (!"logistic".equals(h[0])) throw new IOException("not a logistic model: " + h[0]);
        int n = Integer.parseInt(h[1]);
        features = new String[n];
        System.arraycopy(h, 2, features, 0, n);
        mu = vec(r.readLine(), "mu", n);
        sd = vec(r.readLine(), "sd", n);
        w = vec(r.readLine(), "w", n);
        String[] bl = r.readLine().split(" ");
        if (!"b".equals(bl[0])) throw new IOException("missing b");
        b = Fixtures.parseDouble(bl[1]);
        for (int i = 0; i < n; i++) {
            if (Double.isNaN(mu[i]) || Double.isNaN(w[i]) || Double.isNaN(sd[i])) throw new IOException("nan in weights");
            if (sd[i] == 0) sd[i] = 1;
        }
        if (Double.isNaN(b)) throw new IOException("nan bias");
    }

    private static double[] vec(String line, String tag, int n) throws IOException {
        if (line == null) throw new IOException("missing " + tag);
        String[] p = line.split(" ");
        if (!tag.equals(p[0]) || p.length != n + 1) throw new IOException("bad " + tag + " line");
        double[] v = new double[n];
        for (int i = 0; i < n; i++) v[i] = Fixtures.parseDouble(p[i + 1]);
        return v;
    }

    double[] vector(Map<String, Double> f) {
        double[] x = new double[features.length];
        for (int i = 0; i < x.length; i++) {
            Double v = f.get(features[i]);
            if (v == null) throw new IllegalStateException("missing feature " + features[i]);
            x[i] = v;
        }
        return x;
    }

    double predict(double[] x) {
        double s = b;
        for (int i = 0; i < w.length; i++) s += w[i] * (x[i] - mu[i]) / sd[i];
        return 1.0 / (1.0 + Math.exp(-s));
    }
}
