/* PC 검증 하네스: assets/selftest_daily.txt(8Hz 신호 + Python이 계산한 32개 요약 특징)로 C 이식의 일치를 확인하고
 * 특징 계산 시간을 잰다. 빌드: gcc -O2 -o test_pc test_pc.c features.c -lm
 * 실행: ./test_pc ../android/app/src/main/assets/selftest_daily.txt ../android/app/src/main/assets/daily_arousal.txt
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "features.h"

static int name_index(const char *name) {
    /* "med_hp_mean" / "iqr_hp_mean" → sum[] 인덱스 */
    const char *base = name + 4;
    for (int i = 0; i < MA_NFEAT; i++)
        if (strcmp(MA_FEAT_NAMES[i], base) == 0) return (strncmp(name, "med_", 4) == 0 ? 0 : MA_NFEAT) + i;
    return -1;
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: test_pc selftest_daily.txt daily_arousal.txt\n"); return 2; }
    FILE *fm = fopen(argv[2], "r");
    if (!fm) { perror("model"); return 2; }
    char line[8192];
    fgets(line, sizeof line, fm);
    int nnames = 0;
    int order[MA_NSUM];
    char *tok = strtok(line, " \n");
    tok = strtok(NULL, " \n");  /* count */
    while ((tok = strtok(NULL, " \n")) != NULL && nnames < MA_NSUM) order[nnames++] = name_index(tok);
    fclose(fm);

    FILE *f = fopen(argv[1], "r");
    if (!f) { perror("fixture"); return 2; }
    fgets(line, sizeof line, f);
    int cases = atoi(line + 6);
    double worst = 0;
    double total_us = 0;
    int nwin_total = 0;
    static float u[16384][3];
    static float w8[480][3], w2[120][3];
    static float per[64][MA_NFEAT];
    for (int c = 0; c < cases; c++) {
        fgets(line, sizeof line, f);
        int n = atoi(line + 5);
        static int nan[16384];
        for (int i = 0; i < n; i++) {
            fgets(line, sizeof line, f);
            if (strncmp(line, "nan", 3) == 0) { nan[i] = 1; continue; }
            nan[i] = 0;
            sscanf(line, "%f %f %f", &u[i][0], &u[i][1], &u[i][2]);
        }
        int nmin = 0;
        for (int s = 0; s + 480 <= n; s += 480) {
            int ok = 1;
            for (int i = s; i < s + 480; i++) if (nan[i]) { ok = 0; break; }
            if (!ok) continue;
            memcpy(w8, u + s, sizeof w8);
            ma_block4(w8, 480, w2);
            clock_t t0 = clock();
            ma_features(w2, 120, per[nmin]);
            total_us += (clock() - t0) * 1e6 / CLOCKS_PER_SEC;
            nmin++;
            nwin_total++;
        }
        float sum[MA_NSUM];
        ma_summarize(per, nmin, sum);
        /* feat_arousal 줄과 비교 */
        for (int m = 0; m < 2; m++) {
            fgets(line, sizeof line, f);  /* feat_<task> ... */
            double expect[MA_NSUM];
            char *p = strtok(line, " \n");
            int k = 0;
            while ((p = strtok(NULL, " \n")) != NULL && k < MA_NSUM) expect[k++] = atof(p);
            fgets(line, sizeof line, f);  /* prob_<task> */
            if (m == 0) {
                for (int i = 0; i < MA_NSUM; i++) {
                    double got = sum[order[i]];
                    double rel = fabs(got - expect[i]) / (fabs(expect[i]) > 1e-9 ? fabs(expect[i]) : 1e-9);
                    if (rel > worst) worst = rel;
                }
            }
        }
        printf("case %d: windows=%d\n", c, nmin);
    }
    printf("max relative error (32 summary feats, float32 vs Python float64): %.3e\n", worst);
    printf("feature time per 60s window: %.1f us (PC, %d windows)\n", total_us / nwin_total, nwin_total);
    return worst < 1e-3 ? 0 : 1;  /* float32 vs float64: 작은 값 특징의 상대오차가 수 1e-4까지 남는다 */
}
