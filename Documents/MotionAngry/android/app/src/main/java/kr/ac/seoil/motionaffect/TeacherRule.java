package kr.ac.seoil.motionaffect;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

/**
 * 표정 교사 규칙(설계 2단계, s8_teacher.py와 같은 규칙). 분 단위 표정 집계로 의사 라벨을 만든다.
 *   정서가 라벨 = smile_mean ≥ theta_v,  각성 라벨 = smile_mean + jaw_mean ≥ theta_a,  신뢰도 = face_rate (conf_min 미만이면 라벨 없음)
 * 임계값은 PC 분석(s8_teacher.py, 조정 기간 k일)이 정해 files/models/teacher_params.txt로 넣는다:
 *   theta_v 0.123
 *   theta_a 0.456
 *   conf_min 0.3
 * 파일이 없으면 교사는 비활성(라벨 없음) — 단말이 임의 임계값으로 학생을 가르치지 않게 한다.
 */
final class TeacherRule {
    final double thetaV, thetaA, confMin;

    TeacherRule(double thetaV, double thetaA, double confMin) {
        this.thetaV = thetaV;
        this.thetaA = thetaA;
        this.confMin = confMin;
    }

    static TeacherRule parse(InputStream in) throws IOException {
        double tv = Double.NaN, ta = Double.NaN, cm = 0.3;
        BufferedReader r = new BufferedReader(new InputStreamReader(in));
        String line;
        while ((line = r.readLine()) != null) {
            String[] p = line.trim().split("\\s+");
            if (p.length < 2) continue;
            switch (p[0]) {
                case "theta_v": tv = Fixtures.parseDouble(p[1]); break;
                case "theta_a": ta = Fixtures.parseDouble(p[1]); break;
                case "conf_min": cm = Fixtures.parseDouble(p[1]); break;
                default: break;
            }
        }
        if (Double.isNaN(tv) || Double.isNaN(ta)) throw new IOException("teacher_params missing theta_v/theta_a");
        return new TeacherRule(tv, ta, cm);
    }

    /** {label_v, label_a} (0/1) 또는 null(얼굴 없음·신뢰도 미달). face = {frames, faces, smileSum, jawSum}. */
    int[] label(double[] face) {
        if (face == null || face[0] <= 0 || face[1] <= 0) return null;
        double rate = face[1] / face[0];
        if (rate < confMin) return null;
        double smile = face[2] / face[1], jaw = face[3] / face[1];
        return new int[]{smile >= thetaV ? 1 : 0, smile + jaw >= thetaA ? 1 : 0};
    }
}
