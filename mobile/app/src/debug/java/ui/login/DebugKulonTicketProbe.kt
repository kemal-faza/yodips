package ac.undip.sso.ui.login

import ac.undip.sso.BuildConfig
import ac.undip.sso.core.login.KulonCaptureFailure
import ac.undip.sso.core.login.KulonLandingMarker
import ac.undip.sso.core.login.KulonCaptureOutcome
import ac.undip.sso.core.login.classifyKulonCaptureFailure
import ac.undip.sso.core.login.classifyKulonCaptureLanding
import ac.undip.sso.core.login.classifyKulonCaptureNavigation
import ac.undip.sso.core.login.generateSsoTicket
import ac.undip.sso.core.login.isAllowedLoginHost
import ac.undip.sso.core.login.kulonTicketUrl
import ac.undip.sso.core.login.parseKulonLandingMarkerResult
import ac.undip.sso.core.login.redactKulonCaptureLocation
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import java.security.MessageDigest

private const val TAG = "KulonTicketProbe"
private const val KULON_ORIGIN = "https://kulon2.undip.ac.id/"
private const val PROBE_TIMEOUT_MS = 45_000L

/**
 * Read-only direct-ticket discovery harness. This is intentionally absent from
 * release UI, shares the app CookieManager, and never hands cookies to the API.
 */
@Composable
internal fun DebugKulonTicketProbe(modifier: Modifier = Modifier) {
    if (!BuildConfig.DEBUG) return

    var visible by remember { mutableStateOf(false) }
    var outcomeText by remember { mutableStateOf("belum dijalankan") }
    var probeText by remember { mutableStateOf("probe belum dijalankan") }
    var locationText by remember { mutableStateOf("location=not_started") }
    var completed by remember { mutableStateOf(false) }
    var attemptId by remember { mutableStateOf(0) }
    var baselineCookieFingerprint by remember { mutableStateOf<String?>(null) }
    var probeWebView by remember { mutableStateOf<WebView?>(null) }
    var timeoutTask by remember { mutableStateOf<Runnable?>(null) }
    val handler = remember { Handler(Looper.getMainLooper()) }

    fun finish(
        attempt: Int,
        outcome: KulonCaptureOutcome,
        hasSesskeyMarker: Boolean? = null,
        hasLoginFormMarker: Boolean? = null,
    ) {
        if (attempt != attemptId || completed) return
        completed = true
        timeoutTask?.let(handler::removeCallbacks)

        val currentCookieFingerprint = moodleSessionFingerprint(CookieManager.getInstance())
        val cookieExists = currentCookieFingerprint != null
        val cookieChanged = cookieExists && currentCookieFingerprint != baselineCookieFingerprint
        val markerStatus = hasSesskeyMarker?.toString() ?: "unavailable"
        val loginFormStatus = hasLoginFormMarker?.toString() ?: "unavailable"
        outcomeText = outcome.name.lowercase()
        probeText =
            "sesskey_marker=$markerStatus · login_form_marker=$loginFormStatus · " +
                "MoodleSession exists=$cookieExists · changed=$cookieChanged"

        // Keep the diagnostic artifact to timestamp, outcome and booleans only.
        Log.i(
            TAG,
            "time_epoch_ms=${System.currentTimeMillis()} outcome=${outcome.name} " +
                "sesskey_marker=$markerStatus login_form_marker=$loginFormStatus " +
                "cookie_name=MoodleSession " +
                "cookie_exists=$cookieExists cookie_changed=$cookieChanged",
        )
    }

    fun stopProbe() {
        attemptId += 1
        completed = true
        timeoutTask?.let(handler::removeCallbacks)
        timeoutTask = null
        probeWebView?.stopLoading()
        probeWebView = null
        visible = false
    }

    Button(
        onClick = {
            attemptId += 1
            completed = false
            outcomeText = "menunggu hasil"
            probeText = "menunggu landing Kulon"
            locationText = "location=not_started"
            visible = true
        },
        modifier = modifier,
    ) {
        Text("Diagnosa ticket Kulon")
    }

    if (visible) {
        val activeAttemptId = attemptId
        Dialog(onDismissRequest = ::stopProbe) {
            Surface(
                shape = MaterialTheme.shapes.large,
                tonalElevation = 6.dp,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(520.dp)
                        .padding(16.dp),
                ) {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        Text("Diagnosa Kulon", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.weight(1f))
                        Button(onClick = ::stopProbe) { Text("Tutup") }
                    }
                    Text("Outcome: $outcomeText", style = MaterialTheme.typography.bodyMedium)
                    Text(probeText, style = MaterialTheme.typography.bodySmall)
                    Text("Lokasi: $locationText", style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(8.dp))
                    AndroidView(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        factory = { context ->
                            val cookieManager = CookieManager.getInstance()
                            cookieManager.setAcceptCookie(true)
                            baselineCookieFingerprint = moodleSessionFingerprint(cookieManager)
                            val timeout = Runnable {
                                if (activeAttemptId == attemptId) {
                                    finish(
                                        activeAttemptId,
                                        classifyKulonCaptureFailure(KulonCaptureFailure.TIMEOUT),
                                    )
                                    probeWebView?.stopLoading()
                                }
                            }
                            timeoutTask = timeout
                            handler.postDelayed(timeout, PROBE_TIMEOUT_MS)

                            WebView(context).apply {
                                probeWebView = this
                                settings.javaScriptEnabled = true
                                settings.domStorageEnabled = true
                                settings.setAllowFileAccess(false)
                                webViewClient = object : WebViewClient() {
                                    private fun handleNavigation(
                                        view: WebView,
                                        url: String?,
                                        waitForLandingMarker: Boolean,
                                    ) {
                                        if (activeAttemptId != attemptId || completed) {
                                            view.stopLoading()
                                            return
                                        }
                                        val result = classifyKulonCaptureNavigation(url)
                                        locationText = redactKulonCaptureLocation(url)
                                        Log.i(
                                            TAG,
                                            "state=navigation $locationText",
                                        )
                                        when (result) {
                                            KulonCaptureOutcome.INTERACTION_REQUIRED,
                                            KulonCaptureOutcome.EXTERNAL_HOST,
                                            KulonCaptureOutcome.UNKNOWN_PATH,
                                            KulonCaptureOutcome.UNVERIFIED_LANDING -> {
                                                finish(activeAttemptId, result)
                                                view.stopLoading()
                                            }
                                            KulonCaptureOutcome.LANDING_CANDIDATE -> {
                                                if (waitForLandingMarker) {
                                                    view.evaluateJavascript(KULON_LANDING_MARKERS_PROBE) { raw ->
                                                        if (activeAttemptId != attemptId || completed) {
                                                            return@evaluateJavascript
                                                        }
                                                        val marker = parseKulonLandingMarkerResult(raw)
                                                        val loginFormPresent = marker == KulonLandingMarker.LOGIN_FORM
                                                        val markerPresent = marker == KulonLandingMarker.SESSKEY
                                                        val currentFingerprint = moodleSessionFingerprint(
                                                            CookieManager.getInstance(),
                                                        )
                                                        val cookieChanged = currentFingerprint != null &&
                                                            currentFingerprint != baselineCookieFingerprint
                                                        val landing = classifyKulonCaptureLanding(
                                                            url,
                                                            hasSesskeyMarker = markerPresent,
                                                            hasNewMoodleSessionCookie = cookieChanged,
                                                            hasLoginFormMarker = loginFormPresent,
                                                        )
                                                        finish(
                                                            activeAttemptId,
                                                            landing,
                                                            markerPresent,
                                                            loginFormPresent,
                                                        )
                                                    }
                                                }
                                            }
                                            KulonCaptureOutcome.AUTHENTICATED -> Unit
                                            KulonCaptureOutcome.CAPTURE_IN_PROGRESS -> Unit
                                            KulonCaptureOutcome.TIMEOUT,
                                            KulonCaptureOutcome.NETWORK_FAILURE -> Unit
                                        }
                                    }

                                    override fun onPageStarted(
                                        view: WebView?,
                                        url: String?,
                                        favicon: Bitmap?,
                                    ) {
                                        super.onPageStarted(view, url, favicon)
                                        if (activeAttemptId != attemptId || completed) {
                                            view?.stopLoading()
                                            return
                                        }
                                        view?.let { handleNavigation(it, url, waitForLandingMarker = false) }
                                    }

                                    override fun onPageFinished(view: WebView?, url: String?) {
                                        super.onPageFinished(view, url)
                                        if (completed) return
                                        view?.let { handleNavigation(it, url, waitForLandingMarker = true) }
                                    }

                                    override fun shouldOverrideUrlLoading(
                                        view: WebView?,
                                        request: WebResourceRequest?,
                                    ): Boolean {
                                        if (activeAttemptId != attemptId || completed) return true
                                        val target = request?.url?.toString()
                                        val host = request?.url?.host.orEmpty()
                                        if (!isAllowedLoginHost(host)) {
                                            finish(activeAttemptId, KulonCaptureOutcome.EXTERNAL_HOST)
                                            return true
                                        }
                                        val result = classifyKulonCaptureNavigation(target)
                                        if (result == KulonCaptureOutcome.INTERACTION_REQUIRED ||
                                            result == KulonCaptureOutcome.UNKNOWN_PATH ||
                                            result == KulonCaptureOutcome.EXTERNAL_HOST
                                        ) {
                                            locationText = redactKulonCaptureLocation(target)
                                            Log.i(
                                                TAG,
                                                "state=blocked_navigation $locationText",
                                            )
                                            finish(activeAttemptId, result)
                                            return true
                                        }
                                        return false
                                    }

                                    override fun onReceivedError(
                                        view: WebView?,
                                        request: WebResourceRequest?,
                                        error: WebResourceError?,
                                    ) {
                                        super.onReceivedError(view, request, error)
                                        if (activeAttemptId == attemptId &&
                                            request?.isForMainFrame == true && !completed
                                        ) {
                                            finish(
                                                activeAttemptId,
                                                classifyKulonCaptureFailure(KulonCaptureFailure.NETWORK),
                                            )
                                            view?.stopLoading()
                                        }
                                    }
                                }
                                // Ticket and cookie values remain inside the WebView/CookieManager.
                                // This path has no handoff call and does not clear the cookie jar.
                                loadUrl(kulonTicketUrl(generateSsoTicket()))
                            }
                        },
                    )
                }
            }
        }
    }
}

/** Hash only for an in-memory equality check; the cookie value is never retained or logged. */
internal fun fingerprintMoodleSessionCookieHeader(cookieHeader: String?): String? {
    val sessionCookies = cookieHeader
        ?.split(';')
        ?.mapNotNull { part ->
            val cookie = part.trim()
            val equalsAt = cookie.indexOf('=')
            if (equalsAt < 0) return@mapNotNull null
            val name = cookie.substring(0, equalsAt).trim()
            val value = cookie.substring(equalsAt + 1).trim()
            if (name.startsWith("MoodleSession") && value.isNotEmpty()) "$name=$value" else null
        }
        ?.sorted()
        ?.takeIf { it.isNotEmpty() }
        ?: return null
    return MessageDigest.getInstance("SHA-256")
        .digest(sessionCookies.joinToString(";").toByteArray())
        .joinToString("") { byte -> "%02x".format(byte) }
}

private fun moodleSessionFingerprint(cookieManager: CookieManager): String? =
    fingerprintMoodleSessionCookieHeader(cookieManager.getCookie(KULON_ORIGIN))
