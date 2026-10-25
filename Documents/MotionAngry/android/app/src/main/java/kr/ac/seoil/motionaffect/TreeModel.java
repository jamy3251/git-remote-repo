package kr.ac.seoil.motionaffect;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Map;

/** src/export_model.py가 평탄화한 LightGBM 이진 분류기. 확률 = sigmoid(트리 합). */
final class TreeModel {
    final String[] features;
    private final int[][] feat, left, right;
    private final double[][] thr, leaf;

    TreeModel(InputStream in) throws IOException {
        BufferedReader r = new BufferedReader(new InputStreamReader(in));
        String[] h = r.readLine().split(" ");
        features = new String[Integer.parseInt(h[1])];
        System.arraycopy(h, 2, features, 0, features.length);
        int nt = Integer.parseInt(r.readLine().split(" ")[1]);
        feat = new int[nt][]; left = new int[nt][]; right = new int[nt][];
        thr = new double[nt][]; leaf = new double[nt][];
        for (int t = 0; t < nt; t++) {
            int nn = Integer.parseInt(r.readLine().split(" ")[1]);
            feat[t] = new int[nn]; left[t] = new int[nn]; right[t] = new int[nn];
            thr[t] = new double[nn]; leaf[t] = new double[nn];
            for (int i = 0; i < nn; i++) {
                String[] p = r.readLine().split(" ");
                if (p[0].equals("L")) {
                    feat[t][i] = -1;
                    leaf[t][i] = Double.parseDouble(p[1]);
                } else {
                    feat[t][i] = Integer.parseInt(p[1]);
                    thr[t][i] = Double.parseDouble(p[2]);
                    left[t][i] = Integer.parseInt(p[4]);
                    right[t][i] = Integer.parseInt(p[5]);
                }
            }
        }
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
        double s = 0;
        for (int t = 0; t < feat.length; t++) {
            int i = 0;
            while (feat[t][i] >= 0) i = x[feat[t][i]] <= thr[t][i] ? left[t][i] : right[t][i];
            s += leaf[t][i];
        }
        return 1.0 / (1.0 + Math.exp(-s));
    }
}
