package kr.ac.seoil.motionaffect;

/**
 * 접촉 게이팅(설계 2단계): "기기가 몸에 있는가"를 분 단위로 판정해, 아니면 추정을 보류한다.
 * 규칙(초안, s9_contact_rules.py로 K-EmoPhone에서 검증):
 *   contact = !충전 중 && (화면 켜짐 || 정지 비율 still_frac < 0.9)
 * 충전 중이면 거치돼 있을 가능성이 크고, 화면이 꺼진 채 1분 내내 정지면 책상·주머니 밖에 놓인 것으로 본다.
 * 보류 중에도 affect.csv 행은 기록한다(contact=0). 상시 기록 원칙은 유지(수집은 계속, 추정만 보류).
 */
final class ContactGate {
    static final double STILL_MAX = 0.9;

    static boolean contact(boolean charging, boolean screenOn, double stillFrac) {
        if (charging) return false;
        if (screenOn) return true;
        return !(stillFrac >= STILL_MAX);
    }
}
