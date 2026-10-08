package com.mytrainer.mytrainer

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * 앱이 꺼져 있을 때 받은 지오펜스 이벤트를 쌓아 두는 폴더 큐.
 *
 * 이벤트 하나 = 파일 하나(filesDir/geofence_events/<id>.json). Dart 쪽은
 * path_provider 의 getApplicationSupportDirectory()(= filesDir) 로 이 폴더를 직접
 * 읽으므로 플러터 엔진이 없는 WorkManager 백그라운드에서도 비울 수 있다.
 * 올린 파일만 지우고, 리시버는 항상 새 파일에 쓰기 때문에 둘이 부딪히지 않는다.
 * 파일 이름이 이벤트 id 라서 같은 파일을 두 번 올려도 서버에는 한 건이다.
 */
object GeofenceStore {
    private const val DIR = "geofence_events"
    private const val PREFS = "mytrainer.geofence"

    fun append(ctx: Context, event: JSONObject) {
        val dir = File(ctx.filesDir, DIR).apply { mkdirs() }
        val id = event.getString("id")
        // 다 쓴 다음 이름을 바꿔서, 반쯤 쓴 파일을 Dart 가 읽는 일이 없게 한다.
        val tmp = File(dir, "$id.tmp")
        tmp.writeText(event.toString())
        tmp.renameTo(File(dir, "$id.json"))
    }

    /** 재부팅 후 다시 등록하려고 헬스장 좌표를 기억해 둔다. */
    fun saveGym(ctx: Context, lat: Double, lng: Double, radius: Float) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("lat", lat.toString())
            .putString("lng", lng.toString())
            .putFloat("radius", radius)
            .apply()
    }

    fun clearGym(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun loadGym(ctx: Context): Triple<Double, Double, Float>? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lat = p.getString("lat", null)?.toDoubleOrNull() ?: return null
        val lng = p.getString("lng", null)?.toDoubleOrNull() ?: return null
        return Triple(lat, lng, p.getFloat("radius", 80f))
    }
}
