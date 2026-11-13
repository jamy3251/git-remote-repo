package dev.baekdiscord.devhub

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Alerts {
    const val CHANNEL_ALERTS = "devhub_alerts"
    const val CHANNEL_SERVICE = "devhub_service"

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ALERTS, "세션 알림", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "입력 대기, 오류, 작업 완료, 교차검증 결과"
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_SERVICE, "연결 유지", NotificationManager.IMPORTANCE_LOW).apply {
            description = "백그라운드 알림을 위해 러너와 연결을 유지하는 동안 표시"
        })
    }

    fun openApp(ctx: Context): PendingIntent =
        PendingIntent.getActivity(
            ctx,
            0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun cancel(ctx: Context, id: Int) = NotificationManagerCompat.from(ctx).cancel(id)

    fun post(ctx: Context, id: Int, title: String, text: String) {
        val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_devhub)
            .setColor(ContextCompat.getColor(ctx, R.color.accent))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (_: SecurityException) {
            // Notification permission was revoked; nothing to show.
        }
    }
}
