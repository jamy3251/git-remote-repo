package kr.ac.seoil.motionaffect;

import java.util.ArrayDeque;
import java.util.Locale;

/**
 * 드리프트 가드(설계 R8/D10). 팔 B 격자 탭마다 출하·학생 두 모델을 같은 탭에 채점(a>0 기준)하고,
 * 최근 WINDOW_MS 안에 n≥MIN_N이면 학생 정확도 < 출하 − DROP이면 출하로 복귀, 복귀 후 ≥ 출하 + RECOVER면 재적용.
 * 상수는 초안이며 1단계 데이터로 재조정한다. 전환은 Sink.record("guard", ...)로 기록한다.
 */
final class DriftGuard {
    interface Sink { void record(String type, String value); }

    static final long WINDOW_MS = 14L * 24 * 3_600_000;
    static final int MIN_N = 15;
    static final double DROP = 0.10, RECOVER = 0.05;

    private final Sink sink;
    private final ArrayDeque<long[]> hits = new ArrayDeque<>();  // {wallMs, shipCorrect, studentCorrect}
    private boolean studentActive;

    DriftGuard(Sink sink, boolean studentActive) {
        this.sink = sink;
        this.studentActive = studentActive;
    }

    boolean studentActive() { return studentActive; }

    /** 팔 B 탭 하나를 채점. label01 = a>0 ? 1 : 0 (a==0은 호출하지 않음). */
    void score(long wallMs, int label01, double pShip, double pStudent) {
        if (Double.isNaN(pShip) || Double.isNaN(pStudent)) return;
        hits.addLast(new long[]{wallMs, (pShip >= 0.5 ? 1 : 0) == label01 ? 1 : 0, (pStudent >= 0.5 ? 1 : 0) == label01 ? 1 : 0});
        while (!hits.isEmpty() && wallMs - hits.peekFirst()[0] > WINDOW_MS) hits.pollFirst();
        int n = hits.size();
        if (n < MIN_N) return;
        double ship = 0, stu = 0;
        for (long[] h : hits) { ship += h[1]; stu += h[2]; }
        ship /= n; stu /= n;
        if (studentActive && stu < ship - DROP) {
            studentActive = false;
            sink.record("guard", String.format(Locale.US, "to=ship;n=%d;ship=%.3f;student=%.3f", n, ship, stu));
        } else if (!studentActive && stu >= ship + RECOVER) {
            studentActive = true;
            sink.record("guard", String.format(Locale.US, "to=student;n=%d;ship=%.3f;student=%.3f", n, ship, stu));
        }
    }

    int n() { return hits.size(); }
}
