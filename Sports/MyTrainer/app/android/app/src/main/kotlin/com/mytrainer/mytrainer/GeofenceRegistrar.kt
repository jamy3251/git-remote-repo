package com.mytrainer.mytrainer

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

/**
 * 구글 지오펜싱에 헬스장 한 곳을 등록한다.
 *
 * 폰이 저전력으로 감시하다가 진입·이탈·체류(DWELL) 때 [GeofenceReceiver] 를 깨운다.
 * 앱이 꺼져 있어도 동작한다. 단, 재부팅이나 위치 설정 변경 때 등록이 풀리므로
 * [BootReceiver] 가 다시 건다.
 */
object GeofenceRegistrar {
    private const val TAG = "MyTrainerGeofence"
    const val GYM_ID = "gym"

    /** 이만큼 머물면 DWELL. 출석 판정 규칙(SessionRules.minDwell)과 맞춘다. */
    private const val LOITERING_MS = 20 * 60 * 1000

    private fun pendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, GeofenceReceiver::class.java)
        // 지오펜싱은 인텐트에 결과를 채워 넣으므로 S 이상에서 MUTABLE 이어야 한다.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getBroadcast(ctx, 0, intent, flags)
    }

    @SuppressLint("MissingPermission") // 권한은 Dart 쪽 온보딩에서 받은 뒤에만 호출한다.
    fun register(
        ctx: Context,
        lat: Double,
        lng: Double,
        radius: Float,
        onDone: (Boolean, String?) -> Unit = { _, _ -> },
    ) {
        val fence = Geofence.Builder()
            .setRequestId(GYM_ID)
            .setCircularRegion(lat, lng, radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setLoiteringDelay(LOITERING_MS)
            .setTransitionTypes(
                Geofence.GEOFENCE_TRANSITION_ENTER or
                    Geofence.GEOFENCE_TRANSITION_EXIT or
                    Geofence.GEOFENCE_TRANSITION_DWELL
            )
            .build()
        val request = GeofencingRequest.Builder()
            // 등록 순간 이미 안에 있으면 ENTER 를 바로 보낸다.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(fence)
            .build()

        GeofenceStore.saveGym(ctx, lat, lng, radius)
        LocationServices.getGeofencingClient(ctx)
            .addGeofences(request, pendingIntent(ctx))
            .addOnSuccessListener { onDone(true, null) }
            .addOnFailureListener {
                Log.w(TAG, "지오펜스 등록 실패", it)
                onDone(false, it.message)
            }
    }

    fun unregister(ctx: Context) {
        GeofenceStore.clearGym(ctx)
        LocationServices.getGeofencingClient(ctx).removeGeofences(listOf(GYM_ID))
    }

    /** 저장해 둔 헬스장이 있으면 다시 건다. 재부팅·앱 업데이트 후. */
    fun restore(ctx: Context) {
        val (lat, lng, radius) = GeofenceStore.loadGym(ctx) ?: return
        register(ctx, lat, lng, radius)
    }
}
