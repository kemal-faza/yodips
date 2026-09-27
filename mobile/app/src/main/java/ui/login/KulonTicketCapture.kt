package ac.undip.sso.ui.login

import ac.undip.sso.core.data.DirectTicketCapture
import ac.undip.sso.core.data.DirectTicketCaptureResult
import ac.undip.sso.core.login.KulonCaptureOutcome
import ac.undip.sso.core.login.KulonLandingMarker
import ac.undip.sso.core.login.LoginUrls
import ac.undip.sso.core.login.classifyKulonCaptureLanding
import ac.undip.sso.core.login.classifyKulonCaptureNavigation
import ac.undip.sso.core.login.generateSsoTicket
import ac.undip.sso.core.login.isAllowedLoginHost
import ac.undip.sso.core.login.isMicrosoftAuthorize
import ac.undip.sso.core.login.isSsoLoginPage
import ac.undip.sso.core.login.kulonTicketUrl
import ac.undip.sso.core.login.parseKulonLandingMarkerResult
import ac.undip.sso.core.login.ssoLoginCompleted
import ac.undip.sso.core.network.UpstreamSessionService
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val KULON_ORIGIN = "https://kulon2.undip.ac.id/"
private const val TICKET_CAPTURE_TIMEOUT_MS = 5 * 60 * 1000L
private val LANDING_MARKERS_PROBE =
    """
    (function(){
        var hasSesskey = !!document.querySelector('input[name="sesskey"]');
        var hasLoginForm = !!document.querySelector('input[type="password"], form[action*="login"]');
        return hasLoginForm ? 'login' : (hasSesskey ? 'sesskey' : 'unknown');
    })()
    """.trimIndent()

/** Bridges the suspend recovery call to a user-confirmed Android WebView flow. */
internal class KulonTicketCaptureBridge : DirectTicketCapture {
    internal enum class Stage { WAITING_FOR_USER, CAPTURING }

    internal class Request internal constructor() {
        private val completion = CompletableDeferred<DirectTicketCaptureResult>()
        private val mutableStage = MutableStateFlow(Stage.WAITING_FOR_USER)
        val stage: StateFlow<Stage> = mutableStage.asStateFlow()

        fun start() {
            mutableStage.value = Stage.CAPTURING
        }

        fun finish(result: DirectTicketCaptureResult) {
            completion.complete(result)
        }

        internal suspend fun await(): DirectTicketCaptureResult = completion.await()
        internal val isCompleted: Boolean get() = completion.isCompleted
    }

    private val mutex = Mutex()
    private var activeRequest: Request? = null
    private val mutableRequest = MutableStateFlow<Request?>(null)
    val request: StateFlow<Request?> = mutableRequest.asStateFlow()

    override suspend fun capture(service: UpstreamSessionService): DirectTicketCaptureResult {
        if (service != UpstreamSessionService.KULON) return DirectTicketCaptureResult.Unsupported
        val request = mutex.withLock {
            activeRequest?.takeUnless { it.isCompleted } ?: Request().also {
                activeRequest = it
                mutableRequest.value = it
            }
        }
        return try {
            request.await()
        } finally {
            mutex.withLock {
                if (activeRequest === request) {
                    activeRequest = null
                    mutableRequest.value = null
                }
            }
        }
    }
}

/** A visible CTA is required before the WebView or Microsoft login can open. */
@Composable
internal fun KulonTicketCaptureOverlay(bridge: KulonTicketCaptureBridge) {
    val request by bridge.request.collectAsState()
    val pending = request ?: return
    val stage by pending.stage.collectAsState()

    when (stage) {
        KulonTicketCaptureBridge.Stage.WAITING_FOR_USER ->
            AlertDialog(
                onDismissRequest = { pending.finish(DirectTicketCaptureResult.InteractionRequired) },
                title = { Text("Sesi Kulon perlu diperbarui") },
                text = {
                    Text("YoDips akan membuka Kulon untuk memulihkan sesi. Jika SSO meminta login Microsoft, kamu bisa melanjutkan di sini.")
                },
                confirmButton = {
                    TextButton(onClick = pending::start) { Text("Pulihkan Kulon") }
                },
                dismissButton = {
                    TextButton(onClick = { pending.finish(DirectTicketCaptureResult.InteractionRequired) }) {
                        Text("Nanti")
                    }
                },
            )
        KulonTicketCaptureBridge.Stage.CAPTURING ->
            KulonTicketCaptureDialog(request = pending)
    }
}

@Composable
private fun KulonTicketCaptureDialog(request: KulonTicketCaptureBridge.Request) {
    var webView by remember { mutableStateOf<WebView?>(null) }
    var finished by remember { mutableStateOf(false) }
    var awaitingMicrosoft by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(true) }
    var phase by remember { mutableStateOf(CapturePhase.DIRECT_TICKET) }
    var seenMicrosoft by remember { mutableStateOf(false) }
    var baselineFingerprint by remember { mutableStateOf<String?>(null) }
    val handler = remember { Handler(Looper.getMainLooper()) }

    fun finish(result: DirectTicketCaptureResult) {
        if (finished) return
        finished = true
        busy = false
        awaitingMicrosoft = false
        handler.removeCallbacksAndMessages(null)
        request.finish(result)
    }

    fun startTicket(view: WebView) {
        phase = CapturePhase.DIRECT_TICKET
        awaitingMicrosoft = false
        busy = true
        baselineFingerprint =
            fingerprintMoodleSessionCookieHeader(
                CookieManager.getInstance().getCookie(KULON_ORIGIN),
            )
        view.loadUrl(kulonTicketUrl(generateSsoTicket()))
    }

    fun continueWithMicrosoft() {
        val view = webView ?: return
        phase = CapturePhase.SSO_LOGIN
        seenMicrosoft = false
        awaitingMicrosoft = false
        busy = true
        view.loadUrl(LoginUrls.SSO_LOGIN)
    }

    val timeout = remember(request) {
        Runnable { finish(DirectTicketCaptureResult.NetworkFailure) }
    }

    DisposableEffect(request) {
        handler.postDelayed(timeout, TICKET_CAPTURE_TIMEOUT_MS)
        onDispose {
            handler.removeCallbacksAndMessages(null)
            if (!finished) request.finish(DirectTicketCaptureResult.NetworkFailure)
            webView?.stopLoading()
            webView?.destroy()
            webView = null
        }
    }

    Dialog(onDismissRequest = { finish(DirectTicketCaptureResult.InteractionRequired) }) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            tonalElevation = 6.dp,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(560.dp)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text("Pemulihan Kulon", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { finish(DirectTicketCaptureResult.InteractionRequired) }) {
                        Text("Tutup")
                    }
                }
                if (awaitingMicrosoft) {
                    Text(
                        "SSO meminta interaksi. Lanjutkan hanya jika kamu ingin masuk ke Microsoft untuk Kulon.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Button(onClick = ::continueWithMicrosoft) { Text("Lanjutkan login Microsoft") }
                } else if (busy) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator()
                        Text("Memeriksa sesi Kulon…", style = MaterialTheme.typography.bodySmall)
                    }
                }
                AndroidView(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    factory = { context ->
                        val cookies = CookieManager.getInstance().apply { setAcceptCookie(true) }
                        WebView(context).apply {
                            webView = this
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.loadsImagesAutomatically = true
                            settings.setAllowFileAccess(false)
                            webViewClient =
                                object : WebViewClient() {
                                    private fun handleNavigation(
                                        view: WebView,
                                        url: String?,
                                        inspectLanding: Boolean,
                                    ) {
                                        if (finished) {
                                            view.stopLoading()
                                            return
                                        }
                                        if (phase == CapturePhase.SSO_LOGIN) {
                                            val host = Uri.parse(url.orEmpty()).host.orEmpty()
                                            if (!isAllowedLoginHost(host)) {
                                                finish(DirectTicketCaptureResult.Unsupported)
                                                view.stopLoading()
                                                return
                                            }
                                            if (isMicrosoftAuthorize(url)) seenMicrosoft = true
                                            if (
                                                inspectLanding &&
                                                ssoLoginCompleted(
                                                    url,
                                                    seenMicrosoft,
                                                    cookies.getCookie("https://sso.undip.ac.id")
                                                        ?.contains("ci_session_sso=") == true,
                                                )
                                            ) {
                                                startTicket(view)
                                            }
                                            return
                                        }

                                        when (classifyKulonCaptureNavigation(url)) {
                                            KulonCaptureOutcome.INTERACTION_REQUIRED -> {
                                                awaitingMicrosoft = true
                                                busy = false
                                                view.stopLoading()
                                            }
                                            KulonCaptureOutcome.EXTERNAL_HOST -> {
                                                finish(DirectTicketCaptureResult.Unsupported)
                                                view.stopLoading()
                                            }
                                            KulonCaptureOutcome.UNKNOWN_PATH -> {
                                                finish(DirectTicketCaptureResult.UpstreamInvalid)
                                                view.stopLoading()
                                            }
                                            KulonCaptureOutcome.LANDING_CANDIDATE -> {
                                                if (inspectLanding) {
                                                    view.evaluateJavascript(LANDING_MARKERS_PROBE) { raw ->
                                                        if (finished) return@evaluateJavascript
                                                        val marker = parseKulonLandingMarkerResult(raw)
                                                        val cookieHeader = cookies.getCookie(KULON_ORIGIN)
                                                        val fingerprint =
                                                            fingerprintMoodleSessionCookieHeader(cookieHeader)
                                                        val outcome = classifyKulonCaptureLanding(
                                                            url,
                                                            hasSesskeyMarker = marker == KulonLandingMarker.SESSKEY,
                                                            hasNewMoodleSessionCookie =
                                                                fingerprint != null && fingerprint != baselineFingerprint,
                                                            hasLoginFormMarker = marker == KulonLandingMarker.LOGIN_FORM,
                                                        )
                                                        when (outcome) {
                                                            KulonCaptureOutcome.AUTHENTICATED ->
                                                                if (cookieHeader.isNullOrBlank()) {
                                                                    finish(DirectTicketCaptureResult.UpstreamInvalid)
                                                                } else {
                                                                    finish(DirectTicketCaptureResult.Authenticated(cookieHeader))
                                                                }
                                                            KulonCaptureOutcome.INTERACTION_REQUIRED -> {
                                                                awaitingMicrosoft = true
                                                                busy = false
                                                            }
                                                            else -> finish(DirectTicketCaptureResult.UpstreamInvalid)
                                                        }
                                                    }
                                                }
                                            }
                                            KulonCaptureOutcome.TIMEOUT,
                                            KulonCaptureOutcome.NETWORK_FAILURE -> Unit
                                            KulonCaptureOutcome.AUTHENTICATED,
                                            KulonCaptureOutcome.CAPTURE_IN_PROGRESS,
                                            KulonCaptureOutcome.UNVERIFIED_LANDING -> Unit
                                        }
                                    }

                                    override fun onPageStarted(
                                        view: WebView?,
                                        url: String?,
                                        favicon: Bitmap?,
                                    ) {
                                        super.onPageStarted(view, url, favicon)
                                        view?.let { handleNavigation(it, url, inspectLanding = false) }
                                    }

                                    override fun onPageFinished(view: WebView?, url: String?) {
                                        super.onPageFinished(view, url)
                                        busy = false
                                        view?.let { handleNavigation(it, url, inspectLanding = true) }
                                    }

                                    override fun shouldOverrideUrlLoading(
                                        view: WebView?,
                                        request: WebResourceRequest?,
                                    ): Boolean {
                                        if (finished) return true
                                        val target = request?.url?.toString()
                                        val host = request?.url?.host.orEmpty()
                                        if (!isAllowedLoginHost(host)) {
                                            finish(DirectTicketCaptureResult.Unsupported)
                                            return true
                                        }
                                        if (phase == CapturePhase.SSO_LOGIN) {
                                            if (isMicrosoftAuthorize(target)) seenMicrosoft = true
                                            return false
                                        }
                                        if (classifyKulonCaptureNavigation(target) ==
                                            KulonCaptureOutcome.INTERACTION_REQUIRED
                                        ) {
                                            awaitingMicrosoft = true
                                            busy = false
                                            view?.stopLoading()
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
                                        if (request?.isForMainFrame == true && !finished) {
                                            finish(DirectTicketCaptureResult.NetworkFailure)
                                        }
                                    }
                                }
                            startTicket(this)
                        }
                    },
                )
            }
        }
    }
}

private enum class CapturePhase { DIRECT_TICKET, SSO_LOGIN }
