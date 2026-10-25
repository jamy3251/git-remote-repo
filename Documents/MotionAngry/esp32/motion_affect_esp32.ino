/*
 * MotionAffect ESP32 (설계 3단계 T16): 손목 IMU(MPU-6050, I2C)에서 8Hz 가속도를 읽어
 * 1분마다 특징 16개 → 최근 30분 요약 32개 → 학생 로지스틱(각성·정서가 확률)을 계산하고 Serial로 보고한다.
 * 모드(시리얼 입력 한 글자):
 *   'b' : 벤치마크 — 합성 창으로 ma_features×100, ma_summarize×100, ma_logistic×1000 의 µs 측정(하드웨어 IMU 불필요)
 *   'l' : 로거 — 8Hz 가속도(g)를 "t_ms,x,y,z" CSV로 Serial 출력(PC에서 저장; 손목 데이터 수집용)
 *   'r' : 실행 — 분 단위 추정 보고 "minute,p_arousal,p_valence,feat_us,sum_us"
 * 전력: 측정은 USB 전류계(INA219 또는 USB 테스터)로 외부에서. light sleep은 'r' 모드에서 샘플 사이 사용.
 * 빌드: Arduino IDE, 보드 ESP32 Dev Module, 라이브러리 Wire(기본). features.c/.h, student_weights.h 를 같은 스케치 폴더에 둔다.
 * 【미검증】 실제 IMU 모듈이 없어 하드웨어 경로는 컴파일·논리 검토만 했다. 'b' 모드는 IMU 없이 동작한다.
 */
#include <Wire.h>
extern "C" {
#include "features.h"
}
#include "student_weights.h"

static const int MPU_ADDR = 0x68;
static const int FS_HW = 8;                       // 8Hz 직접 샘플링(K-EmoPhone 손목과 같은 상한)
static const uint32_t SAMPLE_US = 1000000UL / FS_HW;
static float win8[480][3];
static float win2[120][3];
static float per[MA_KEEP_MIN][MA_NFEAT];
static int nper = 0, head = 0;
static int nsamp = 0;
static char mode = 'b';

static bool mpuInit() {
  Wire.begin();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); Wire.write(0);                 // sleep off
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C); Wire.write(0x00);              // ±2g
  Wire.endTransmission();
  return true;
}

static bool mpuRead(float *xyz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  Wire.requestFrom(MPU_ADDR, 6);
  if (Wire.available() < 6) return false;
  for (int i = 0; i < 3; i++) {
    int16_t v = (Wire.read() << 8) | Wire.read();
    xyz[i] = v / 16384.0f;                          // ±2g → g
  }
  return true;
}

static void synth(float w[][3], int n, uint32_t seed) {
  for (int i = 0; i < n; i++) {
    seed = seed * 1664525u + 1013904223u;
    float j = ((seed >> 8) & 0xFFFF) / 65535.0f - 0.5f;
    w[i][0] = 0.3f + 0.05f * j; w[i][1] = 0.02f * j; w[i][2] = 0.95f + 0.03f * j;
  }
}

static void benchmark() {
  synth(win2, 120, 7);
  float f[MA_NFEAT], sum[MA_NSUM];
  uint32_t t0 = micros();
  for (int i = 0; i < 100; i++) ma_features(win2, 120, f);
  uint32_t featUs = (micros() - t0) / 100;
  for (int i = 0; i < MA_KEEP_MIN; i++) for (int k = 0; k < MA_NFEAT; k++) per[i][k] = f[k] * (1 + 0.01f * i);
  t0 = micros();
  for (int i = 0; i < 100; i++) ma_summarize(per, MA_KEEP_MIN, sum);
  uint32_t sumUs = (micros() - t0) / 100;
  t0 = micros();
  volatile float p = 0;
  for (int i = 0; i < 1000; i++) p += ma_logistic(sum, MA_AROUSAL_MU, MA_AROUSAL_SD, MA_AROUSAL_W, MA_AROUSAL_B);
  uint32_t logUs = (micros() - t0) / 1000;
  Serial.printf("BENCH feat_us=%lu summarize30_us=%lu logistic_us=%lu heap_free=%u cpu_mhz=%u\n",
                (unsigned long)featUs, (unsigned long)sumUs, (unsigned long)logUs, ESP.getFreeHeap(), getCpuFrequencyMhz());
}

void setup() {
  Serial.begin(115200);
  delay(500);
  bool mpu = mpuInit();
  Serial.printf("MotionAffect ESP32 mpu=%d  (b: bench, l: log, r: run)\n", mpu);
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'b' || c == 'l' || c == 'r') { mode = c; nsamp = 0; nper = 0; head = 0; Serial.printf("mode=%c\n", c); }
  }
  if (mode == 'b') { benchmark(); delay(5000); return; }
  static uint32_t next = micros();
  uint32_t now = micros();
  if ((int32_t)(now - next) < 0) { delayMicroseconds(200); return; }
  next += SAMPLE_US;
  float xyz[3];
  if (!mpuRead(xyz)) return;
  if (mode == 'l') { Serial.printf("%lu,%.4f,%.4f,%.4f\n", (unsigned long)millis(), xyz[0], xyz[1], xyz[2]); return; }
  // 'r': 1분(480샘플) 모아서 특징 → 요약 → 확률
  win8[nsamp][0] = xyz[0]; win8[nsamp][1] = xyz[1]; win8[nsamp][2] = xyz[2];
  if (++nsamp < 480) return;
  nsamp = 0;
  uint32_t t0 = micros();
  ma_block4(win8, 480, win2);
  ma_features(win2, 120, per[head]);
  uint32_t featUs = micros() - t0;
  head = (head + 1) % MA_KEEP_MIN;
  if (nper < MA_KEEP_MIN) nper++;
  if (nper < 5) { Serial.printf("minute %d: warming up\n", nper); return; }
  float sum[MA_NSUM];
  t0 = micros();
  ma_summarize(per, nper, sum);
  float pa = ma_logistic(sum, MA_AROUSAL_MU, MA_AROUSAL_SD, MA_AROUSAL_W, MA_AROUSAL_B);
  float pv = ma_logistic(sum, MA_VALENCE_MU, MA_VALENCE_SD, MA_VALENCE_W, MA_VALENCE_B);
  uint32_t sumUs = micros() - t0;
  Serial.printf("minute,%d,p_arousal,%.3f,p_valence,%.3f,feat_us,%lu,sum_us,%lu\n", nper, pa, pv, (unsigned long)featUs, (unsigned long)sumUs);
}
