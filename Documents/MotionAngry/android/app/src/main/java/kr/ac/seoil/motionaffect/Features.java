package kr.ac.seoil.motionaffect;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * src/s1b_wesad.py raw_feats(orient=False)의 Java 이식. 같은 입력이면 같은 값이 나와야 한다(selftest로 검증).
 * 입력 acc: [n][3], 단위 g, 표본 주파수 fs.
 */
final class Features {
    private Features() {}

    static Map<String, Double> compute(double[][] acc, int fs) {
        int n = acc.length;
        double[] mag = new double[n];
        for (int i = 0; i < n; i++) {
            mag[i] = Math.sqrt(acc[i][0] * acc[i][0] + acc[i][1] * acc[i][1] + acc[i][2] * acc[i][2]);
        }
        double[] med = medfilt(mag, fs * 2 + 1);
        double[] hp = new double[n];
        for (int i = 0; i < n; i++) hp[i] = mag[i] - med[i];

        Map<String, Double> f = new HashMap<>();
        stats(hp, "hp", f);
        spectral(hp, fs, "hp", f);
        double[] jerk = new double[n - 1];
        for (int i = 0; i < n - 1; i++) jerk[i] = Math.abs((mag[i + 1] - mag[i]) * fs);
        stats(jerk, "jerk", f);

        int secs = n / fs;
        double[] sec = new double[secs];
        int still = 0;
        for (int s = 0; s < secs; s++) {
            sec[s] = std(Arrays.copyOfRange(hp, s * fs, (s + 1) * fs));
            if (sec[s] < 0.01) still++;
        }
        double m = mean(sec);
        f.put("sec_std_mean", m);
        f.put("sec_std_cv", std(sec) / (m + 1e-9));
        f.put("still_frac", (double) still / secs);
        return f;
    }

    private static void stats(double[] x, String p, Map<String, Double> f) {
        double[] s = x.clone();
        Arrays.sort(s);
        f.put(p + "_mean", mean(x));
        f.put(p + "_std", std(x));
        f.put(p + "_p10", percentile(s, 10));
        f.put(p + "_p90", percentile(s, 90));
        f.put(p + "_iqr", percentile(s, 75) - percentile(s, 25));
    }

    /** scipy.signal.welch 기본값: 주기형 Hann, 50% 겹침, 구간별 평균 제거, density, 단측. */
    private static void spectral(double[] x0, int fs, String p, Map<String, Double> f) {
        int n = x0.length;
        double mu = mean(x0);
        double[] x = new double[n];
        for (int i = 0; i < n; i++) x[i] = x0[i] - mu;
        int seg = Math.min(n, fs * 8);
        int step = seg - seg / 2;
        double[] win = new double[seg];
        double wss = 0;
        for (int i = 0; i < seg; i++) {
            win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / seg);
            wss += win[i] * win[i];
        }
        int nf = seg / 2 + 1;
        double[] pxx = new double[nf];
        int count = 0;
        double[] re = new double[seg], im = new double[seg];
        for (int start = 0; start + seg <= n; start += step) {
            double sm = 0;
            for (int i = 0; i < seg; i++) sm += x[start + i];
            sm /= seg;
            for (int i = 0; i < seg; i++) {
                re[i] = (x[start + i] - sm) * win[i];
                im[i] = 0;
            }
            fft(re, im);
            for (int k = 0; k < nf; k++) {
                double v = (re[k] * re[k] + im[k] * im[k]) / (fs * wss);
                if (k > 0 && !(seg % 2 == 0 && k == nf - 1)) v *= 2;
                pxx[k] += v;
            }
            count++;
        }
        double tot = 0;
        int arg = 0;
        for (int k = 0; k < nf; k++) {
            pxx[k] /= count;
            tot += pxx[k];
            if (pxx[k] > pxx[arg]) arg = k;
        }
        tot += 1e-12;
        double df = (double) fs / seg;
        f.put(p + "_domf", arg * df);
        double ent = 0;
        for (int k = 0; k < nf; k++) {
            double q = pxx[k] / tot;
            ent -= q * Math.log(q + 1e-12);
        }
        f.put(p + "_sent", ent);
        double[][] bands = {{0.1, 1}, {1, 3}, {3, 8}, {8, 16}};
        String[] names = {"0.1-1", "1-3", "3-8", "8-16"};
        for (int b = 0; b < bands.length; b++) {
            if (!(bands[b][0] < fs / 2.0)) continue;
            double s = 0;
            for (int k = 0; k < nf; k++) {
                double fk = k * df;
                if (fk >= bands[b][0] && fk < bands[b][1]) s += pxx[k];
            }
            f.put(p + "_bp" + names[b], s / tot);
        }
    }

    /** 반복형 radix-2 FFT (길이는 2의 거듭제곱). */
    private static void fft(double[] re, double[] im) {
        int n = re.length;
        if (Integer.bitCount(n) != 1) throw new IllegalArgumentException("FFT length " + n);
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                double t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2 * Math.PI / len;
            for (int i = 0; i < n; i += len) {
                for (int k = 0; k < len / 2; k++) {
                    double wr = Math.cos(ang * k), wi = Math.sin(ang * k);
                    int a = i + k, b = a + len / 2;
                    double xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                }
            }
        }
    }

    /** scipy.signal.medfilt: 가장자리는 0으로 채운다. */
    private static double[] medfilt(double[] x, int k) {
        int n = x.length, h = k / 2;
        double[] out = new double[n], w = new double[k];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < k; j++) {
                int t = i - h + j;
                w[j] = (t < 0 || t >= n) ? 0 : x[t];
            }
            Arrays.sort(w);
            out[i] = w[h];
        }
        return out;
    }

    /** numpy.percentile 기본(linear). s는 정렬된 배열. */
    private static double percentile(double[] s, double q) {
        double pos = q / 100.0 * (s.length - 1);
        int lo = (int) Math.floor(pos);
        int hi = Math.min(lo + 1, s.length - 1);
        return s[lo] + (s[hi] - s[lo]) * (pos - lo);
    }

    private static double mean(double[] x) {
        double s = 0;
        for (double v : x) s += v;
        return s / x.length;
    }

    private static double std(double[] x) {
        double m = mean(x), s = 0;
        for (double v : x) s += (v - m) * (v - m);
        return Math.sqrt(s / x.length);
    }
}
