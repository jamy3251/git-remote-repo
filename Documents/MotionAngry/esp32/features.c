/* Features.java의 C 이식. 같은 입력이면 Java/Python과 같은 값(float32 반올림 범위 안)이어야 한다. test_pc.c로 검증. */
#include "features.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

const char *MA_FEAT_NAMES[MA_NFEAT] = {
    "hp_bp0.1-1", "hp_domf", "hp_iqr", "hp_mean", "hp_p10", "hp_p90", "hp_sent", "hp_std",
    "jerk_iqr", "jerk_mean", "jerk_p10", "jerk_p90", "jerk_std", "sec_std_cv", "sec_std_mean", "still_frac"};

static int cmpf(const void *a, const void *b) {
    float x = *(const float *)a, y = *(const float *)b;
    return (x > y) - (x < y);
}

static float mean_f(const float *x, int n) {
    double s = 0;
    for (int i = 0; i < n; i++) s += x[i];
    return (float)(s / n);
}

static float std_f(const float *x, int n) {
    double m = mean_f(x, n), s = 0;
    for (int i = 0; i < n; i++) s += ((double)x[i] - m) * ((double)x[i] - m);
    return (float)sqrt(s / n);
}

/* numpy.percentile 기본(linear). s는 정렬된 배열 */
static float pct(const float *s, int n, float q) {
    double pos = q / 100.0 * (n - 1);
    int lo = (int)floor(pos);
    int hi = lo + 1 < n ? lo + 1 : n - 1;
    return (float)(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

/* scipy.signal.medfilt: 가장자리 0 채움 */
static void medfilt(const float *x, int n, int k, float *out) {
    int h = k / 2;
    float w[32];
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < k; j++) {
            int t = i - h + j;
            w[j] = (t < 0 || t >= n) ? 0 : x[t];
        }
        qsort(w, k, sizeof(float), cmpf);
        out[i] = w[h];
    }
}

static void fft(float *re, float *im, int n) {
    for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            float t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (int len = 2; len <= n; len <<= 1) {
        double ang = -2 * M_PI / len;
        for (int i = 0; i < n; i += len) {
            for (int k = 0; k < len / 2; k++) {
                float wr = (float)cos(ang * k), wi = (float)sin(ang * k);
                int a = i + k, b = a + len / 2;
                float xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr; im[a] += xi;
            }
        }
    }
}

void ma_block4(const float in[][3], int n_in, float out[][3]) {
    int n = n_in / 4;
    for (int i = 0; i < n; i++)
        for (int d = 0; d < 3; d++)
            out[i][d] = (in[4 * i][d] + in[4 * i + 1][d] + in[4 * i + 2][d] + in[4 * i + 3][d]) / 4.0f;
}

static void stats(const float *x, int n, float *mean, float *sd, float *p10, float *p90, float *iqr) {
    float s[MA_WIN];
    memcpy(s, x, n * sizeof(float));
    qsort(s, n, sizeof(float), cmpf);
    *mean = mean_f(x, n);
    *sd = std_f(x, n);
    *p10 = pct(s, n, 10);
    *p90 = pct(s, n, 90);
    *iqr = pct(s, n, 75) - pct(s, n, 25);
}

/* Welch(주기형 Hann, 50% 겹침, density, 단측). seg = min(n, fs*8) = 16 at fs=2 */
static void spectral(const float *x0, int n, int fs, float *domf, float *sent, float *bp01_1) {
    float mu = mean_f(x0, n);
    int seg = n < fs * 8 ? n : fs * 8;
    int step = seg - seg / 2;
    float win[16], wss = 0;
    for (int i = 0; i < seg; i++) {
        win[i] = 0.5f - 0.5f * (float)cos(2 * M_PI * i / seg);
        wss += win[i] * win[i];
    }
    int nf = seg / 2 + 1;
    float pxx[9] = {0};
    int count = 0;
    float re[16], im[16];
    for (int start = 0; start + seg <= n; start += step) {
        float sm = 0;
        for (int i = 0; i < seg; i++) sm += x0[start + i] - mu;
        sm /= seg;
        for (int i = 0; i < seg; i++) {
            re[i] = (x0[start + i] - mu - sm) * win[i];
            im[i] = 0;
        }
        fft(re, im, seg);
        for (int k = 0; k < nf; k++) {
            float v = (re[k] * re[k] + im[k] * im[k]) / (fs * wss);
            if (k > 0 && !(seg % 2 == 0 && k == nf - 1)) v *= 2;
            pxx[k] += v;
        }
        count++;
    }
    float tot = 0;
    int arg = 0;
    for (int k = 0; k < nf; k++) {
        pxx[k] /= count;
        tot += pxx[k];
        if (pxx[k] > pxx[arg]) arg = k;
    }
    tot += 1e-12f;
    float df = (float)fs / seg;
    *domf = arg * df;
    float ent = 0;
    for (int k = 0; k < nf; k++) {
        float q = pxx[k] / tot;
        ent -= q * (float)log(q + 1e-12);
    }
    *sent = ent;
    float s = 0;
    for (int k = 0; k < nf; k++) {
        float fk = k * df;
        if (fk >= 0.1f && fk < 1.0f) s += pxx[k];
    }
    *bp01_1 = s / tot;
}

void ma_features(const float acc[][3], int n, float out[MA_NFEAT]) {
    float mag[MA_WIN], med[MA_WIN], hp[MA_WIN], jerk[MA_WIN];
    for (int i = 0; i < n; i++) mag[i] = (float)sqrt((double)acc[i][0] * acc[i][0] + (double)acc[i][1] * acc[i][1] + (double)acc[i][2] * acc[i][2]);
    medfilt(mag, n, MA_FS * 2 + 1, med);
    for (int i = 0; i < n; i++) hp[i] = mag[i] - med[i];
    float hmean, hsd, hp10, hp90, hiqr;
    stats(hp, n, &hmean, &hsd, &hp10, &hp90, &hiqr);
    float domf, sent, bp;
    spectral(hp, n, MA_FS, &domf, &sent, &bp);
    for (int i = 0; i < n - 1; i++) jerk[i] = (float)fabs((mag[i + 1] - mag[i]) * MA_FS);
    float jmean, jsd, jp10, jp90, jiqr;
    stats(jerk, n - 1, &jmean, &jsd, &jp10, &jp90, &jiqr);
    int secs = n / MA_FS;
    float sec[MA_WIN / MA_FS];
    int still = 0;
    for (int s = 0; s < secs; s++) {
        sec[s] = std_f(hp + s * MA_FS, MA_FS);
        if (sec[s] < 0.01f) still++;
    }
    float m = mean_f(sec, secs);
    out[0] = bp; out[1] = domf; out[2] = hiqr; out[3] = hmean; out[4] = hp10; out[5] = hp90; out[6] = sent; out[7] = hsd;
    out[8] = jiqr; out[9] = jmean; out[10] = jp10; out[11] = jp90; out[12] = jsd;
    out[13] = std_f(sec, secs) / (m + 1e-9f); out[14] = m; out[15] = (float)still / secs;
}

void ma_summarize(const float per[][MA_NFEAT], int nmin, float sum[MA_NSUM]) {
    float col[MA_KEEP_MIN];
    for (int f = 0; f < MA_NFEAT; f++) {
        for (int i = 0; i < nmin; i++) col[i] = per[i][f];
        qsort(col, nmin, sizeof(float), cmpf);
        sum[f] = pct(col, nmin, 50);
        sum[MA_NFEAT + f] = pct(col, nmin, 75) - pct(col, nmin, 25);
    }
}

float ma_logistic(const float x[MA_NSUM], const float mu[MA_NSUM], const float sd[MA_NSUM], const float w[MA_NSUM], float b) {
    float s = b;
    for (int i = 0; i < MA_NSUM; i++) s += w[i] * (x[i] - mu[i]) / sd[i];
    return 1.0f / (1.0f + (float)exp(-s));
}
