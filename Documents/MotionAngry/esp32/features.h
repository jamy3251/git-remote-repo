/* MotionAffect ESP32 port (설계 3단계 T16): Features.java(fs=2, 60초 창 120샘플)의 C 이식.
 * 입력: 2Hz 가속도 크기 신호가 아니라 8Hz 가속도 xyz(g) 480샘플 → 4개 평균(block4) → 120샘플 → 특징 16개.
 * float32 사용(ESP32 Xtensa LX6/LX7은 단정밀도 FPU 보유). 설계 문서의 '고정소수점'은 FPU 없는 MCU용 선택지였고,
 * ESP32에서는 float32가 더 단순·빠르다(차이는 PC 테스트로 측정: selftest_daily 기준 상대오차 보고).
 */
#ifndef MA_FEATURES_H
#define MA_FEATURES_H

#include <stdint.h>

#define MA_FS 2
#define MA_WIN 120           /* 60초 × 2Hz */
#define MA_NFEAT 16
#define MA_NSUM 32           /* med_ 16 + iqr_ 16 */
#define MA_KEEP_MIN 30

#ifdef __cplusplus
extern "C" {
#endif

/* 특징 이름 순서(Java AffectRow.keys와 같은 오름차순). */
extern const char *MA_FEAT_NAMES[MA_NFEAT];

/* 8Hz xyz(g) 480샘플 → 4개 평균 → 120샘플 xyz. out[120][3] */
void ma_block4(const float in[][3], int n_in, float out[][3]);

/* 2Hz xyz(g) 120샘플 → 특징 16개(MA_FEAT_NAMES 순서). */
void ma_features(const float acc[][3], int n, float out[MA_NFEAT]);

/* 분 특징의 중앙값·사분위 범위 요약: per[nmin][16] → sum[32] (med_ 16개 뒤에 iqr_ 16개, 각각 MA_FEAT_NAMES 순서). */
void ma_summarize(const float per[][MA_NFEAT], int nmin, float sum[MA_NSUM]);

/* 학생 로지스틱: sum[32] 표준화 후 sigmoid(w·z + b). names 순서는 head_features.txt(med_* 16, iqr_* 16; 특징 이름 순서는 모델 파일이 정함). */
float ma_logistic(const float x[MA_NSUM], const float mu[MA_NSUM], const float sd[MA_NSUM], const float w[MA_NSUM], float b);

#ifdef __cplusplus
}
#endif
#endif
