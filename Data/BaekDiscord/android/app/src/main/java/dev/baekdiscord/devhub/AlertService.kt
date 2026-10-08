package dev.baekdiscord.devhub

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Optional background alerts without Firebase: a foreground service keeps one WebSocket to the
 * runner and turns its events into notifications (input needed, error, finished, cross-review).
 */
class AlertService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
    private var ws: WebSocket? = null
    private var stopped = false
    private var backoffMs = 2_000L

    /** Last known agent state per session, to alert only on transitions. */
    private val states = HashMap<String, String>()
    /** Work-log keys already announced ("<id>" or "<id>:<review status>"). */
    private val seen = HashSet<String>()
    private var seededLog = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Alerts.ensureChannels(this)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, SERVICE_ID, serviceNotification("연결 중"), type)
        stopped = false
        if (ws == null) connect()
        return START_STICKY
    }

    private fun serviceNotification(status: String) =
        NotificationCompat.Builder(this, Alerts.CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_devhub)
            .setContentTitle("DevHub 알림 대기")
            .setContentText(status)
            .setOngoing(true)
            .setContentIntent(Alerts.openApp(this))
            .build()

    private fun setStatus(status: String) {
        getSystemService(android.app.NotificationManager::class.java).notify(SERVICE_ID, serviceNotification(status))
    }

    private fun connect() {
        val c = Connection.load(this)
        if (c == null) {
            stopSelf()
            return
        }
        val req = Request.Builder()
            .url(c.wsUrl())
            .header("User-Agent", "DevHubApp/${BuildConfig.VERSION_NAME}")
            .header("ngrok-skip-browser-warning", "1")
            .build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoffMs = 2_000L
                webSocket.send("""{"type":"worklog","limit":50}""")
                main.post { setStatus("연결됨 · ${c.host}") }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    handle(JSONObject(text))
                } catch (_: Exception) {
                    // Malformed frame: ignore.
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry(code)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = retry(response?.code ?: 0)
        })
    }

    private fun retry(code: Int) {
        ws = null
        if (stopped) return
        main.post {
            if (code == 4001 || code == 401) {
                setStatus("토큰이 맞지 않습니다. 앱에서 다시 연결하세요")
                return@post
            }
            setStatus("연결 끊김 · ${backoffMs / 1000}초 뒤 재시도")
            main.postDelayed({ if (!stopped && ws == null) connect() }, backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(60_000L)
        }
    }

    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "sessions" -> {
                val list = m.optJSONArray("sessions") ?: return
                for (i in 0 until list.length()) {
                    val s = list.getJSONObject(i)
                    states[s.getString("id")] = s.optString("state")
                }
            }
            "updated" -> onSession(m.getJSONObject("session"))
            "worklog" -> {
                // Initial snapshot: remember what's already there, announce nothing.
                val list = m.optJSONArray("entries") ?: return
                for (i in 0 until list.length()) seen.add(logKey(list.getJSONObject(i)))
                seededLog = true
            }
            "worklog_entry" -> if (seededLog) onWork(m.getJSONObject("entry"))
        }
    }

    private fun onSession(s: JSONObject) {
        val id = s.getString("id")
        val tags = s.optJSONArray("tags")?.toString() ?: ""
        if (tags.contains("\"review\"")) return
        val state = s.optString("state")
        val prev = states.put(id, state)
        if (prev == null || prev == state) return
        val name = s.optString("name")
        val line = s.optJSONObject("suggestion")?.optString("label")?.takeIf { it.isNotBlank() } ?: s.optString("lastLine")
        when (state) {
            "waiting_input" -> Alerts.post(this, id.hashCode(), "입력 대기 · $name", line.ifBlank { "응답이 필요합니다" })
            "error" -> Alerts.post(this, id.hashCode(), "오류 · $name", line.ifBlank { "세션에 오류가 났습니다" })
            // Answered or moving again (from the phone, the PC or the supervisor): the alert is stale.
            else -> if (prev == "waiting_input" || prev == "error") Alerts.cancel(this, id.hashCode())
        }
    }

    private fun logKey(e: JSONObject): String {
        val reviews = e.optJSONArray("reviews")
        val last = if (reviews != null && reviews.length() > 0) reviews.getJSONObject(reviews.length() - 1) else null
        return if (last == null) e.getString("id") else "${e.getString("id")}:${last.optString("sessionId")}:${last.optString("status")}"
    }

    private fun onWork(e: JSONObject) {
        val key = logKey(e)
        if (!seen.add(key)) return
        val name = e.optString("name")
        val reviews = e.optJSONArray("reviews")
        val last = if (reviews != null && reviews.length() > 0) reviews.getJSONObject(reviews.length() - 1) else null
        val notifyId = e.getString("id").hashCode() + 1
        if (last != null) {
            val status = last.optString("status")
            if (status == "running") return
            val who = if (last.optString("reviewer") == "codex") "Codex" else "Claude"
            val verdict = when {
                status == "failed" -> "결과 없음"
                last.optString("verdict") == "pass" -> "통과"
                last.optString("verdict") == "fail" -> "수정 필요"
                else -> "판단 보류"
            }
            Alerts.post(this, notifyId, "$who 교차검증 $verdict · $name", last.optString("summary"))
        } else {
            val ok = e.optString("status") == "exited" && e.optInt("exitCode", -1) == 0
            Alerts.post(this, notifyId, "${if (ok) "완료" else "끝남"} · $name", e.optString("summary"))
        }
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        ws?.close(1000, "stop")
        ws = null
        super.onDestroy()
    }

    companion object {
        private const val SERVICE_ID = 1001
    }
}
