package dev.baekdiscord.devhub

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * A thin native shell around the runner's dashboard: connect once by QR, then the same /control
 * UI as the browser, plus things a web page can't do well on a phone (background alerts).
 */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null
    private var conn: Connection? = null

    /** True while the WebView shows a page from the connected runner; gates the JS bridge. */
    @Volatile
    var pageTrusted = false
        private set

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startAlerts() else Connection.prefs(this).edit().putBoolean(Connection.KEY_ALERTS, false).apply()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Alerts.ensureChannels(this)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = web
                if (w != null && w.canGoBack()) w.goBack() else moveTaskToBack(true)
            }
        })
        val saved = Connection.load(this)
        if (saved == null) showSetup(null) else showDashboard(saved)
        if (Connection.prefs(this).getBoolean(Connection.KEY_ALERTS, false)) startAlerts()
    }

    // --- setup -------------------------------------------------------------------------------

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    /** Dashboard-style button: filled accent for the main action, outlined for the rest. */
    private fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        stateListAnimator = null
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(if (primary) 0xFFFFFFFF.toInt() else ContextCompat.getColor(this@MainActivity, R.color.fg))
        background = GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            setColor(ContextCompat.getColor(this@MainActivity, if (primary) R.color.accent_strong else R.color.surface))
            setStroke(dp(1), ContextCompat.getColor(this@MainActivity, if (primary) R.color.accent_strong else R.color.border))
        }
        setOnClickListener { onClick() }
    }

    private fun showSetup(error: String?) {
        web?.destroy()
        web = null
        pageTrusted = false
        val fg = ContextCompat.getColor(this, R.color.fg)
        val muted = ContextCompat.getColor(this, R.color.muted)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.bg))
        }
        root.addView(TextView(this).apply {
            text = "DevHub 관제"
            setTextColor(fg)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            typeface = Typeface.DEFAULT_BOLD
        })
        root.addView(TextView(this).apply {
            text = "PC의 DevHub 러너에 연결합니다. PC 대시보드에서 원격 접속 → ngrok 열기를 누르고 나온 QR을 찍거나, 링크를 붙여 넣으세요."
            setTextColor(muted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(0, dp(12), 0, dp(24))
        })
        root.addView(button("QR 찍기", true) { scan() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
        val input = EditText(this).apply {
            hint = "https://…/control#rt=…"
            setSingleLine(true)
            setTextColor(fg)
            setHintTextColor(muted)
        }
        root.addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })
        root.addView(button("링크로 연결", false) { connect(input.text.toString()) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(10) })
        if (error != null) {
            root.addView(TextView(this).apply {
                text = error
                setTextColor(0xFFF87171.toInt())
                setPadding(0, dp(16), 0, 0)
                gravity = Gravity.START
            })
        }
        setContentView(root)
    }

    private fun scan() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code -> connect(code.rawValue ?: "") }
            .addOnFailureListener { e -> showSetup("QR 스캐너를 열 수 없습니다: ${e.message}. 링크를 붙여 넣어 주세요.") }
    }

    private fun connect(link: String) {
        val c = Connection.parse(link)
        if (c == null) {
            showSetup("대시보드 링크가 아닙니다. 주소 끝에 #rt=토큰 이 있어야 합니다.")
            return
        }
        c.save(this)
        showDashboard(c)
        if (Connection.prefs(this).getBoolean(Connection.KEY_ALERTS, false)) startAlerts()
    }

    // --- dashboard ---------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private fun showDashboard(c: Connection) {
        conn = c
        val w = WebView(this)
        w.setBackgroundColor(ContextCompat.getColor(this, R.color.bg))
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // A non-browser user agent makes ngrok skip its "you are about to visit" interstitial.
            userAgentString = "DevHubApp/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})"
        }
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                if (host == c.host) return false
                // Anything off the runner opens in the real browser: the bridge never sees foreign pages.
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                pageTrusted = url != null && Uri.parse(url).host == c.host
            }
        }
        w.addJavascriptInterface(Bridge(), "DevHubApp")
        w.loadUrl(c.dashboardUrl(), mapOf("ngrok-skip-browser-warning" to "1"))
        web = w
        setContentView(w)
    }

    fun resetConnection() {
        stopService(Intent(this, AlertService::class.java))
        Connection.clear(this)
        showSetup(null)
    }

    fun setAlerts(on: Boolean) {
        Connection.prefs(this).edit().putBoolean(Connection.KEY_ALERTS, on).apply()
        if (!on) {
            stopService(Intent(this, AlertService::class.java))
            return
        }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else startAlerts()
    }

    private fun startAlerts() {
        if (Connection.load(this) == null) return
        ContextCompat.startForegroundService(this, Intent(this, AlertService::class.java))
    }

    override fun onDestroy() {
        web?.destroy()
        super.onDestroy()
    }

    /** Exposed to the dashboard as `window.DevHubApp`; every call checks the page is the runner's. */
    inner class Bridge {
        @JavascriptInterface
        fun isApp(): Boolean = pageTrusted

        @JavascriptInterface
        fun version(): String = if (pageTrusted) BuildConfig.VERSION_NAME else ""

        @JavascriptInterface
        fun backgroundAlerts(): Boolean = pageTrusted && Connection.prefs(this@MainActivity).getBoolean(Connection.KEY_ALERTS, false)

        @JavascriptInterface
        fun setBackgroundAlerts(on: Boolean) {
            if (pageTrusted) runOnUiThread { setAlerts(on) }
        }

        @JavascriptInterface
        fun resetConnection() {
            if (pageTrusted) runOnUiThread { this@MainActivity.resetConnection() }
        }
    }
}
