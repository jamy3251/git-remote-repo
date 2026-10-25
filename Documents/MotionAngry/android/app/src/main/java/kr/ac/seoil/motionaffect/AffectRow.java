package kr.ac.seoil.motionaffect;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * affect.csv v2 행(설계 R4): 분당 1행, 넓은 형식. 학생 모델이 배울 특징을 폰이 계산한 그대로 적는다.
 * 열 순서(기존 8열 유지 후 추가):
 *   t_ns,wall_ms,minutes,p_arousal,p_valence,minute_us,estimate_us,app,
 *   v, screen_on, tilt_deg, held, face_frames, face_rate, smile_mean, jaw_mean,
 *   m_<분 특징 16, 키 오름차순>, s_med_<16>, s_iqr_<16>
 * 결측(얼굴 프레임 0, 추정 미달 등)은 빈 값. 열 수는 항상 같다.
 */
final class AffectRow {
    static final int VERSION = 3;  // v3: 끝에 p_student_a, p_student_v, contact 추가
    static final String[] BASE = {"t_ns", "wall_ms", "minutes", "p_arousal", "p_valence", "minute_us", "estimate_us", "app"};
    static final String[] EXTRA = {"v", "screen_on", "tilt_deg", "held", "face_frames", "face_rate", "smile_mean", "jaw_mean"};
    static final String[] TAIL = {"p_student_a", "p_student_v", "contact"};

    /** 분 특징 키를 오름차순으로 고정한다(Map 순서에 의존하지 않도록). */
    static List<String> keys(Map<String, Double> minuteFeats) {
        return new ArrayList<>(new TreeMap<>(minuteFeats).keySet());
    }

    static String header(List<String> keys) {
        StringBuilder b = new StringBuilder(String.join(",", BASE)).append(',').append(String.join(",", EXTRA));
        for (String k : keys) b.append(",m_").append(k);
        for (String k : keys) b.append(",s_med_").append(k);
        for (String k : keys) b.append(",s_iqr_").append(k);
        b.append(',').append(String.join(",", TAIL));
        return b.append('\n').toString();
    }

    static int columns(List<String> keys) {
        return BASE.length + EXTRA.length + 3 * keys.size() + TAIL.length;
    }

    /**
     * @param p         {p_arousal, p_valence} 또는 null(5분 미만)
     * @param summary   30분 요약(med_/iqr_ 키) 또는 null
     * @param posture   PostureRule.classify 결과 {tilt, std, code}
     * @param face      {frames, faces, smileSum, jawSum}; frames==0이면 얼굴 열은 빈 값
     */
    static String row(long tNs, long wallMs, int minutes, double[] p, long minuteUs, long estimateUs, String app,
                      boolean screenOn, double[] posture, double[] face, Map<String, Double> minuteFeats,
                      Map<String, Double> summary, List<String> keys) {
        return row(tNs, wallMs, minutes, p, minuteUs, estimateUs, app, screenOn, posture, face, minuteFeats, summary, keys,
                null, -1);
    }

    /** @param student {p_student_a, p_student_v} 또는 null; contact -1이면 빈 값 */
    static String row(long tNs, long wallMs, int minutes, double[] p, long minuteUs, long estimateUs, String app,
                      boolean screenOn, double[] posture, double[] face, Map<String, Double> minuteFeats,
                      Map<String, Double> summary, List<String> keys, double[] student, int contact) {
        StringBuilder b = new StringBuilder();
        b.append(tNs).append(',').append(wallMs).append(',').append(minutes).append(',')
                .append(p == null ? "" : f4(p[0])).append(',').append(p == null ? "" : f4(p[1])).append(',')
                .append(minuteUs).append(',').append(estimateUs).append(',').append(app.replace(',', '_'))
                .append(',').append(VERSION).append(',').append(screenOn ? 1 : 0)
                .append(',').append(Double.isNaN(posture[0]) ? "" : f1(posture[0]))
                .append(',').append((int) posture[2]);
        double frames = face == null ? 0 : face[0];
        if (frames > 0) {
            double faces = face[1];
            b.append(',').append((int) frames).append(',').append(f3(faces / frames))
                    .append(',').append(faces > 0 ? f4(face[2] / faces) : "")
                    .append(',').append(faces > 0 ? f4(face[3] / faces) : "");
        } else {
            b.append(",0,,,");
        }
        for (String k : keys) b.append(',').append(g6(minuteFeats.get(k)));
        for (String k : keys) b.append(',').append(summary == null ? "" : g6(summary.get("med_" + k)));
        for (String k : keys) b.append(',').append(summary == null ? "" : g6(summary.get("iqr_" + k)));
        b.append(',').append(student == null || Double.isNaN(student[0]) ? "" : f4(student[0]))
                .append(',').append(student == null || Double.isNaN(student[1]) ? "" : f4(student[1]))
                .append(',').append(contact < 0 ? "" : String.valueOf(contact));
        return b.append('\n').toString();
    }

    private static String f4(double v) { return String.format(Locale.US, "%.4f", v); }
    private static String f3(double v) { return String.format(Locale.US, "%.3f", v); }
    private static String f1(double v) { return String.format(Locale.US, "%.1f", v); }
    private static String g6(Double v) { return v == null || v.isNaN() ? "" : String.format(Locale.US, "%.6g", v); }
}
