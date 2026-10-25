package kr.ac.seoil.motionaffect;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 팔 B 알람과 재부팅을 받아 LifeLogService에 넘긴다. 일상 기록이 켜져 있던 상태(prefs life_running)에서만 동작한다.
 * 동의 화면(설계 R7, T12)이 들어오면 동의 완료 조건이 여기에 추가된다.
 */
public class AskAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_ALARM = "kr.ac.seoil.motionaffect.ASK_ALARM";
    static final String PREFS = "life";
    static final String KEY_RUNNING = "life_running";

    @Override
    public void onReceive(Context c, Intent i) {
        boolean running = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_RUNNING, false);
        if (!running) return;
        Intent svc = new Intent(c, LifeLogService.class);
        if (ACTION_ALARM.equals(i.getAction())) {
            svc.setAction(LifeLogService.ACTION_ASK_ALARM).putExtra("idx", i.getIntExtra("idx", -1));
        }
        // 재부팅(BOOT_COMPLETED)이면 액션 없이 서비스만 다시 올린다. 서비스가 시작되며 알람을 재등록한다.
        c.startForegroundService(svc);
    }
}
