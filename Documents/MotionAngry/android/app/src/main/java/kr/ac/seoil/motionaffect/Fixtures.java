package kr.ac.seoil.motionaffect;

/**
 * 텍스트 픽스처·모델 파일·CSV의 숫자 토큰을 한 곳에서 읽는다(설계 Section 2 Q2).
 * Python이 쓰는 'nan', 빈 값, 'NaN', 'null' 모두 NaN. 그 밖의 파싱 실패는 NumberFormatException 그대로(파일 손상 탐지용).
 */
final class Fixtures {
    private Fixtures() {}

    static double parseDouble(String s) {
        if (s == null) return Double.NaN;
        String t = s.trim();
        if (t.isEmpty() || t.equalsIgnoreCase("nan") || t.equalsIgnoreCase("null")) return Double.NaN;
        return Double.parseDouble(t);
    }

    static boolean isNaN(String s) {
        return Double.isNaN(parseDouble(s));
    }
}
