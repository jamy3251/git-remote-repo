package com.mytrainer.mytrainer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import org.json.JSONObject
import java.util.UUID

/**
 * 지오펜스 전이를 받아 파일 큐에 적는다. 플러터 엔진 없이 깨어나므로
 * 여기서는 기록만 하고 서버 업로드는 Dart 쪽이 한다.
 */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            Log.w("MyTrainerGeofence", "지오펜스 오류 코드 ${event.errorCode}")
            return
        }
        val kind = when (event.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
            Geofence.GEOFENCE_TRANSITION_DWELL -> "dwell"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
            else -> return
        }
        val loc = event.triggeringLocation
        val json = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("kind", kind)
            .put("at", System.currentTimeMillis())
            .put("mock", isMock(loc))
        GeofenceStore.append(context, json)
    }

    private fun isMock(loc: Location?): Boolean {
        if (loc == null) return false
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            loc.isMock
        } else {
            @Suppress("DEPRECATION")
            loc.isFromMockProvider
        }
    }
}

/** 재부팅·앱 업데이트 뒤 지오펜스를 다시 건다. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> GeofenceRegistrar.restore(context)
        }
    }
}
