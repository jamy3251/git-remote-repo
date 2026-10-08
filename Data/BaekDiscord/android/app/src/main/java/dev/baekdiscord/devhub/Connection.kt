package dev.baekdiscord.devhub

import android.content.Context
import android.net.Uri

/**
 * Where the runner is and how to authenticate: parsed from the dashboard link the runner shows as a
 * QR code (`https://<tunnel>/control#rt=<token>`). Stored in app-private preferences.
 */
data class Connection(val base: String, val token: String) {
    val host: String get() = Uri.parse(base).host ?: ""

    fun dashboardUrl(): String = "$base/control#rt=${Uri.encode(token)}"

    fun wsUrl(): String {
        val ws = if (base.startsWith("https://")) "wss://" + base.removePrefix("https://") else "ws://" + base.removePrefix("http://")
        return "$ws/runner/ws?token=${Uri.encode(token)}"
    }

    fun save(ctx: Context) {
        prefs(ctx).edit().putString(KEY_BASE, base).putString(KEY_TOKEN, token).apply()
    }

    companion object {
        private const val PREFS = "devhub"
        private const val KEY_BASE = "base"
        private const val KEY_TOKEN = "token"
        const val KEY_ALERTS = "alerts"

        fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun load(ctx: Context): Connection? {
            val p = prefs(ctx)
            val base = p.getString(KEY_BASE, null) ?: return null
            val token = p.getString(KEY_TOKEN, null) ?: return null
            return Connection(base, token)
        }

        fun clear(ctx: Context) {
            prefs(ctx).edit().remove(KEY_BASE).remove(KEY_TOKEN).putBoolean(KEY_ALERTS, false).apply()
        }

        /** Accepts the full dashboard link; returns null when it has no host or no `rt=` token. */
        fun parse(link: String): Connection? {
            val uri = Uri.parse(link.trim())
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme != "https" && scheme != "http") return null
            val authority = uri.encodedAuthority ?: return null
            val fragment = uri.encodedFragment ?: return null
            val token = fragment.split("&")
                .map { it.split("=", limit = 2) }
                .firstOrNull { it.size == 2 && it[0] == "rt" }
                ?.let { Uri.decode(it[1]) }
                ?.trim()
            if (token.isNullOrEmpty() || token.length < 16) return null
            return Connection("$scheme://$authority", token)
        }
    }
}
