package kr.ac.seoil.motionaffect;

/**
 * 폰 자세 규칙(설계 R5). 분 단위 8Hz 가속도 창(g 단위)과 화면 상태로 세 가지를 나눈다.
 *   held(1)  = 화면 켜짐 ∧ 15° ≤ tilt ≤ 80° ∧ 분 내 |a| 표준편차 > 0.01 g   (손에 들고 보는 중)
 *   flat(0)  = tilt < 15° ∧ 표준편차 ≤ 0.01 g                               (책상 위에 놓임)
 *   other(2) = 나머지(주머니·걷기·세워 둠 등)
 * tilt = acos(|ḡz| / |ḡ|): 평균 중력 벡터가 기기 z축(화면 법선)과 이루는 각. 임계값은 초안이며
 * 1단계 조정 기간(R3)에 얼굴 검출률을 기준으로 다시 맞춘다. 사용한 값은 결과 파일에 기록한다.
 */
final class PostureRule {
    static final int FLAT = 0, HELD = 1, OTHER = 2;
    static final double TILT_MIN_DEG = 15, TILT_MAX_DEG = 80, STD_MIN_G = 0.01;

    /** {tilt_deg, std_g, code}. 빈 창이면 {NaN, NaN, OTHER}. */
    static double[] classify(double[][] win, boolean screenOn) {
        if (win == null || win.length == 0) return new double[]{Double.NaN, Double.NaN, OTHER};
        double sx = 0, sy = 0, sz = 0;
        double[] mag = new double[win.length];
        for (int i = 0; i < win.length; i++) {
            sx += win[i][0]; sy += win[i][1]; sz += win[i][2];
            mag[i] = Math.sqrt(win[i][0] * win[i][0] + win[i][1] * win[i][1] + win[i][2] * win[i][2]);
        }
        int n = win.length;
        double gx = sx / n, gy = sy / n, gz = sz / n;
        double g = Math.sqrt(gx * gx + gy * gy + gz * gz);
        double tilt = g < 1e-9 ? 90 : Math.toDegrees(Math.acos(Math.min(1.0, Math.abs(gz) / g)));
        double mean = 0;
        for (double m : mag) mean += m;
        mean /= n;
        double var = 0;
        for (double m : mag) var += (m - mean) * (m - mean);
        double std = Math.sqrt(var / n);
        int code;
        if (screenOn && tilt >= TILT_MIN_DEG && tilt <= TILT_MAX_DEG && std > STD_MIN_G) code = HELD;
        else if (tilt < TILT_MIN_DEG && std <= STD_MIN_G) code = FLAT;
        else code = OTHER;
        return new double[]{tilt, std, code};
    }
}
