package kr.ac.seoil.motionaffect;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 일상 정서 추정 엔진 (src/export_daily.py와 같은 계산).
 *  1분마다: 최근 60초 가속도(g) → 8Hz 격자 선형 보간(1초 넘는 공백이면 그 분은 건너뜀) → 4개 평균 → 2Hz
 *           → Features.compute(fs=2) 16개를 저장
 *  저장된 최근 30분 중 5분 이상 있으면: 분별 특징의 중앙값(med_)·사분위 범위(iqr_) 32개 → 각성·정서가 트리 모델 → 확률
 */
final class DailyEngine {
    static final int FS8 = 8, WIN_S = 60, KEEP_MIN = 30, MIN_WINDOWS = 5;
    private static final long GAP_NS = 1_000_000_000L;

    private final TreeModel arousal, valence;
    private final ArrayDeque<long[]> times = new ArrayDeque<>();          // 각 분의 끝 시각(ns)
    private final ArrayDeque<Map<String, Double>> perMin = new ArrayDeque<>();

    DailyEngine(TreeModel arousal, TreeModel valence) {
        this.arousal = arousal;
        this.valence = valence;
    }

    /** t(ns 오름차순), xyz(g)에서 [tEnd-60s, tEnd) 를 8Hz 격자로. 공백이 있으면 null. */
    static double[][] grid8(long[] t, double[][] xyz, int n, long tEnd) {
        int m = WIN_S * FS8;
        long t0 = tEnd - WIN_S * 1_000_000_000L;
        double[][] out = new double[m][3];
        int k = 0;
        for (int s = 0; s < m; s++) {
            long g = t0 + s * (1_000_000_000L / FS8);
            while (k + 1 < n && t[k + 1] <= g) k++;
            if (k + 1 >= n || t[k] > g) return null;
            if (t[k + 1] - t[k] > GAP_NS) return null;
            double w = (double) (g - t[k]) / (t[k + 1] - t[k]);
            for (int d = 0; d < 3; d++) out[s][d] = xyz[k][d] + (xyz[k + 1][d] - xyz[k][d]) * w;
        }
        return out;
    }

    static double[][] block4(double[][] w) {
        int n = w.length / 4;
        double[][] out = new double[n][3];
        for (int i = 0; i < n; i++)
            for (int d = 0; d < 3; d++)
                out[i][d] = (w[4 * i][d] + w[4 * i + 1][d] + w[4 * i + 2][d] + w[4 * i + 3][d]) / 4.0;
        return out;
    }

    /** 8Hz 60초 창 하나 → 분 특징 저장. */
    private Map<String, Double> lastMin;

    void addMinute(long tEndNs, double[][] win8) {
        lastMin = Features.compute(block4(win8), 2);
        perMin.addLast(lastMin);
        times.addLast(new long[]{tEndNs});
        while (!times.isEmpty() && tEndNs - times.peekFirst()[0] >= KEEP_MIN * 60_000_000_000L) {
            times.pollFirst();
            perMin.pollFirst();
        }
    }

    int minutes() {
        return perMin.size();
    }

    static Map<String, Double> summarize(List<Map<String, Double>> per) {
        Map<String, Double> f = new HashMap<>();
        for (String k : per.get(0).keySet()) {
            double[] v = new double[per.size()];
            for (int i = 0; i < v.length; i++) v[i] = per.get(i).get(k);
            Arrays.sort(v);
            f.put("med_" + k, pct(v, 50));
            f.put("iqr_" + k, pct(v, 75) - pct(v, 25));
        }
        return f;
    }

    private static double pct(double[] s, double q) {
        double pos = q / 100.0 * (s.length - 1);
        int lo = (int) Math.floor(pos);
        int hi = Math.min(lo + 1, s.length - 1);
        return s[lo] + (s[hi] - s[lo]) * (pos - lo);
    }

    /** {p_arousal, p_valence}; 분 특징이 5개 미만이면 null. */
    double[] estimate() {
        if (perMin.size() < MIN_WINDOWS) return null;
        Map<String, Double> f = summarize(new ArrayList<>(perMin));
        return new double[]{arousal.predict(arousal.vector(f)), valence.predict(valence.vector(f))};
    }

    Map<String, Double> summary() {
        return perMin.isEmpty() ? null : summarize(new ArrayList<>(perMin));
    }

    /** 가장 최근에 넣은 분의 특징 16개(affect.csv v2 m_ 열). */
    Map<String, Double> lastMinute() {
        return lastMin;
    }
}
