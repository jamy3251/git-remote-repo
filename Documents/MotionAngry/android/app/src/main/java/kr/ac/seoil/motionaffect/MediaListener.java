package kr.ac.seoil.motionaffect;

import android.service.notification.NotificationListenerService;

/**
 * 알림 접근 권한을 받기 위한 빈 리스너. 이 권한이 있어야 다른 앱의 재생 정보(곡·영상 제목)를 읽을 수 있다.
 * 알림 내용 자체는 읽거나 저장하지 않는다.
 */
public class MediaListener extends NotificationListenerService {
}
