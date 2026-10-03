package ac.undip.sso.ui.login

import ac.undip.sso.BuildConfig
import ac.undip.sso.core.login.LoginUrls
import ac.undip.sso.core.login.generateSsoTicket
import ac.undip.sso.core.login.isAllowedLoginHost
import ac.undip.sso.core.login.redactKulonCaptureLocation
import ac.undip.sso.core.login.isAuthenticatedKulonUrl
import ac.undip.sso.core.login.isAuthenticatedSiapUrl
import ac.undip.sso.core.login.isLoginInteractionAllowed
import ac.undip.sso.core.login.isMicrosoftAuthorize
import ac.undip.sso.core.login.isSsoLoginPage
import ac.undip.sso.core.login.kulonTicketUrl
import ac.undip.sso.core.login.siapTicketUrl
import ac.undip.sso.core.login.ssoLoginCompleted
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.HandoffResult
import ac.undip.sso.core.data.TokenStoreLike
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val SSO_HOST = "sso.undip.ac.id"
private const val SIAP_HOST = "siap.undip.ac.id"
private const val KULON_HOST = "kulon2.undip.ac.id"
private const val SSO_COOKIE = "ci_session_sso"
private const val SIAP_COOKIE = "sia_app_session"

/**
 * A hop in the automatic cascade that never finishes (dropped redirect, missing
 * cookie, wedged WebView) must surface an explicit failure with retry actions
 * instead of spinning forever — the old dead end forced users to clear app data.
 * The timer restarts on every observable navigation, so it only measures a
 * stalled hop, not the whole login.
 */
private const val LOGIN_STALL_TIMEOUT_MS = 45_000L

private const val LOGIN_LOAD_FAILED_MESSAGE =
    "Gagal memuat halaman login. Periksa koneksi internet lalu coba lagi."

/**
 * JS normalizer injected into the SSO login page on finish (see CHECKPOINT
 * Path A spike): the in-app WebView fails to paint the official SSO login card
 * (it loads off-screen at y≈-295 and under a fixed full-screen `.bg-image`
 * blur; the EnjoyHint onboarding overlay also covers it).
 *
 * The shim used to pin `div.card` at a FIXED `top:150px` with a hard `380px`
 * width and `body{overflow:auto}`. A fixed element does not scroll with the
 * page, so once the campus page grew taller (or the viewport is narrower than
 * 380px) the LOGIN button fell below the screen and could not be reached —
 * "halaman login tidak bisa discroll, tombol tersembunyi".
 *
 * This version makes the card a full-viewport, internally-scrollable panel:
 *  - hide the decorative fixed `.bg-image`,
 *  - neutralise the page's fixed/overflow layout so scrolling works,
 *  - render the login card full-height/width with `overflow-y:auto` (its own
 *    scrollbar), so any amount of content stays reachable,
 *  - add permanent bottom scroll slack (45% of the layout height) so the LOGIN
 *    button can always be scrolled above the soft keyboard. Computed in JS and
 *    applied inline with `!important`: CSS `vh` resolves to 0 inside this
 *    embedded WebView, and the page's Bootstrap padding utilities otherwise
 *    win over a stylesheet rule.
 *  - remove the EnjoyHint onboarding overlay + mark it done in localStorage,
 *  - fall back to tagging the login form's parent when the `div.card` selector
 *    no longer matches the campus markup,
 *  - re-apply every 500ms for ~5s to survive late/async rendering.
 * Idempotent; safe to run on every SSO page finish.
 */
private const val SSO_LAYOUT_SHIM =
    """
(function(){
  function card(){
    return document.querySelector('div.card')||document.querySelector('.undip-login-card');
  }
  function size(){
    var c=card();
    if(!c){return;}
    var slack=Math.round((window.innerHeight||0)*0.45);
    c.style.setProperty('padding-bottom',(48+slack)+'px','important');
  }
  function apply(){
    var st=document.getElementById('undip-fix');
    if(!st){st=document.createElement('style');st.id='undip-fix';document.head.appendChild(st);}
    st.textContent=
      'html,body{height:auto!important;min-height:100%!important;overflow-x:hidden!important;overflow-y:auto!important;position:static!important;}'+
      'div.bg-image{display:none!important;}'+
      'div.card,.undip-login-card{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;'+
        'width:100%!important;max-width:100vw!important;height:auto!important;margin:0!important;'+
        'overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;'+
        'z-index:2147483647!important;background:#ffffff!important;box-shadow:0 6px 24px rgba(0,0,0,.25)!important;'+
        'border-radius:0!important;padding:24px 20px 48px!important;box-sizing:border-box!important;}'+
      'div.card .card-body,div.card .card-content,div.card form{margin:0!important;padding:0!important;background:transparent!important;}'+
      '.enjoyhint_skip_btn,.enjoyhint_next_btn,.enjoyhint_close_btn,#enjoyhint{display:none!important;}';
    if(!document.querySelector('div.card')){
      var form=document.querySelector('form[action*="auth_v2"],form');
      var host=form&&form.closest?form.closest('div'):null;
      if(host){host.classList.add('undip-login-card');}
    }
    document.querySelectorAll('#enjoyhint,[class*="enjoyhint"]').forEach(function(e){e.remove();});
    try{localStorage.setItem('intro_tour_login', JSON.stringify({intro_tour_login_isDone:true}));}catch(e){}
    size();
  }
  apply();
  window.addEventListener('resize',size);
  var n=0;
  var t=setInterval(function(){apply();if(++n>=10){clearInterval(t);}},500);
})();
"""

/**
 * In-app WebView login with a single-tab cascade:
 *   SSO (Microsoft OIDC-backed) → Kulon → SIAP → handoff
 *
 * Each hop navigates the SAME WebView so the shared CookieManager collects every
 * *real* (logged-in) session cookie; on completion we `POST /api/auth/session/handoff`
 * and the backend validates the Kulon session and issues the JWT. Credentials
 * never reach our backend (the SSO sign-in is delegated to Microsoft).
 *
 * Isolation contract (why this is not just "a browser"):
 *  - The user may only touch a credential page (Microsoft sign-in / the SSO
 *    login form). Every other page — the whole automatic redirect cascade —
 *    is covered by a scrim that also swallows pointer events, so a stray tap
 *    cannot knock the flow off its rails (see `isLoginInteractionAllowed`).
 *  - User-gesture navigations that would leave a credential page (reset
 *    password, registration, terms, help, ...) are ignored; server redirects
 *    and the form POST still run. Non-SSO/Microsoft hosts are blocked as
 *    before.
 *  - "Ulangi" is always reachable: an always-visible button on credential
 *    pages, the overlay button while redirecting, and retry actions on
 *    failure. It purges cookies + DOM storage and recreates the WebView, so a
 *    stale/half-written session cannot wedge every retry (previously the only
 *    escape was clearing app data).
 *  - Popups, file access, form autofill and the long-press context menu are
 *    switched off; the WebView is a login surface, not a general browser.
 *
 * History/fixes (see docs/CHECKPOINT.md):
 *  - SSO login is backed by Microsoft: `/auth/user/login` 302-redirects to
 *    `login.microsoftonline.com`. The WebView must ALLOW the Microsoft OIDC
 *    hosts (isAllowedLoginHost) or the sign-in can never render.
 *  - `/user/login` (old entry) returned a 404; use `/auth/user/login`.
 *  - The SSO page drops a gt cookie `ci_session_sso` on load, so we advance
 *    SSO→Kulon only after the interactive Microsoft round-trip finishes
 *    (ssoLoginCompleted), never merely because a guest cookie exists.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    tokenStore: TokenStoreLike,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var phase by remember { mutableIntStateOf(0) } // 0=SSO,1=Kulon,2=SIAP,3=handoff
    var seenMicrosoft by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    // URL of the page currently in the WebView; drives the interaction lock.
    var currentUrl by remember { mutableStateOf<String?>(null) }
    // Handoff finished: late WebView callbacks must not undo the logged-in state.
    var done by remember { mutableStateOf(false) }
    // Bumped to rebuild the WebView from scratch on an explicit restart.
    var webViewKey by remember { mutableIntStateOf(0) }

    fun slog(msg: String) {
        if (BuildConfig.DEBUG) Log.i("SSOLogin", msg)
    }

    fun capture(
        host: String,
        name: String,
    ): String? =
        CookieManager.getInstance().getCookie("https://$host")?.let { all ->
            all
                .split(";")
                .firstOrNull { it.trimStart().startsWith("$name=") }
                ?.substringAfter("=")
                ?.trim()
        }

    /** Full raw cookie header `name=value; ...` for a host (null when none). */
    fun captureAll(host: String): String? =
        CookieManager.getInstance().getCookie("https://$host")?.let { all ->
            all
                .split(";")
                .map { it.trim() }
                .filter { it.contains('=') }
                .joinToString("; ")
                .takeIf { it.isNotBlank() }
        }

    /** Raw SSO cookie header (the `ci_session_sso` guard cookie). */
    fun captureSso(): String? =
        capture(SSO_HOST, SSO_COOKIE)?.let {
            "ci_session_sso=$it"
        }

    /** Terminal failure state: the overlay offers the retry actions below. */
    fun fail(message: String) {
        if (done) return
        loading = false
        error = message
    }

    /** Handoff runs once from the SIAP hop (phase 2 finished); guarded by phase. */
    fun doHandoff(
        view: WebView,
        siap: String,
        kulon: String,
    ) {
        if (done || phase != 2) return
        phase = 3
        loading = true
        error = null
        slog("handoff siap=${siap.isNotBlank()} kulon=${kulon.isNotBlank()}")
        scope.launch {
            // Sertakan cookie SSO (`ci_session_sso`) agar sesi tersimpan backend
            // punya hasSso → /api/auth/me `complete` bisa tercapai; tanpa ini
            // deteksi dini sesi mati di boot selalu meminta login ulang.
            when (val r = Backend.handoff(siap, kulon, captureSso())) {
                is HandoffResult.Success -> {
                    if (done) return@launch
                    done = true
                    loading = false
                    slog("handoff OK")
                    Backend.authToken = r.token
                    tokenStore.save(r.token, siap, kulon)
                    onLoggedIn()
                }

                is HandoffResult.Failure -> {
                    slog("handoff FAIL")
                    loading = false
                    error = r.reason
                    phase = 2 // allow a cheap handoff retry with the still-live cookies
                }
            }
        }
    }

    /**
     * Full login restart: purge every web session the login WebView could have
     * collected (SSO/Microsoft/Kulon/SIAP cookies + DOM storage) and recreate
     * the WebView at the SSO entry. The purge is what makes a retry reliable —
     * without it a stale or half-written cookie keeps serving the same broken
     * page, and the only previous escape was clearing app data.
     */
    fun restartLogin() {
        if (done) return
        slog("restart")
        loading = false
        error = null
        phase = 0
        seenMicrosoft = false
        currentUrl = null
        webView?.apply {
            stopLoading()
            clearCache(true)
            clearFormData()
        }
        webView = null
        val cookies = CookieManager.getInstance()
        cookies.removeAllCookies(null)
        cookies.flush()
        WebStorage.getInstance().deleteAllData()
        webViewKey += 1
    }

    /**
     * Retry the step that failed: a failed handoff can be repeated with the
     * cookies still in the jar (no re-login), anything else starts over.
     */
    fun retryLogin() {
        val view = webView
        val siap = captureAll(SIAP_HOST).orEmpty()
        val kulon = captureAll(KULON_HOST).orEmpty()
        if (view != null && phase == 2 && (siap.isNotBlank() || kulon.isNotBlank())) {
            doHandoff(view, siap, kulon)
        } else {
            restartLogin()
        }
    }

    fun createLoginWebView(webContext: Context): WebView =
        WebView(webContext).apply {
            webView = this
            CookieManager.getInstance().setAcceptCookie(true)
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadsImagesAutomatically = true
            // No local files ever need to load; blocking file access
            // closes a file:// exfiltration/JS vector in the WebView.
            settings.setAllowFileAccess(false)
            // Never persist or autofill what the user typed into the credential
            // form, and never let the page spawn popup windows.
            settings.saveFormData = false
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            // The login surface has no use for a long-press context menu
            // ("open in new tab", "share link", ...).
            setOnLongClickListener { true }
            // Second line of defence next to the Compose scrim: while a blocking
            // overlay is up (automatic cascade lock or a terminal error) the
            // WebView itself ignores touch, so a stray gesture can never disturb
            // the page behind the overlay.
            setOnTouchListener { _, _ ->
                error != null || !isLoginInteractionAllowed(currentUrl)
            }
            webViewClient =
                object : WebViewClient() {
                    override fun onPageStarted(
                        view: WebView?,
                        url: String?,
                        favicon: Bitmap?,
                    ) {
                        super.onPageStarted(view, url, favicon)
                        if (done) {
                            view?.stopLoading()
                            return
                        }
                        slog("onPageStarted p$phase ${redactKulonCaptureLocation(url)}")
                        currentUrl = url
                        loading = true
                        // A hop through Microsoft marks a real sign-in round-trip.
                        if (isMicrosoftAuthorize(url)) seenMicrosoft = true
                    }

                    override fun onPageFinished(
                        view: WebView?,
                        url: String?,
                    ) {
                        super.onPageFinished(view, url)
                        if (done) return
                        slog("onPageFinished p$phase ${redactKulonCaptureLocation(url)}")
                        currentUrl = url
                        loading = false
                        // Normalize the SSO login layout so its card actually
                        // paints in this WebView (see SSO_LAYOUT_SHIM). Apply
                        // on ANY visit to the SSO login page and self-heal the
                        // phase: a bounce back here (e.g. a failed SIAP hop)
                        // would otherwise leave a blank page with phase>0 and
                        // no shim. `seenMicrosoft` is intentionally kept so a
                        // real post-login return (with `code`) still advances.
                        if (isSsoLoginPage(url)) {
                            phase = 0
                            try {
                                view?.evaluateJavascript(SSO_LAYOUT_SHIM, null)
                            } catch (_: Exception) {
                                // best-effort; ignore if the page is navigating away
                            }
                        }
                        when {
                            phase == 0 &&
                                ssoLoginCompleted(
                                    url,
                                    seenMicrosoft,
                                    capture(SSO_HOST, SSO_COOKIE) != null,
                                )
                            -> {
                                phase = 1
                                view?.loadUrl(kulonTicketUrl(generateSsoTicket()))
                            }

                            phase == 1 && isAuthenticatedKulonUrl(url) -> {
                                phase = 2
                                view?.loadUrl(siapTicketUrl(generateSsoTicket()))
                            }

                            phase == 2 &&
                                isAuthenticatedSiapUrl(url) &&
                                capture(SIAP_HOST, SIAP_COOKIE) != null
                            -> {
                                val siap = captureAll(SIAP_HOST).orEmpty()
                                val kulon = captureAll(KULON_HOST).orEmpty()
                                view?.let { doHandoff(it, siap, kulon) }
                            }
                        }
                    }

                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?,
                    ): Boolean {
                        val target = request?.url?.toString()
                        val host = request?.url?.host.orEmpty()
                        val mainFrame = request?.isForMainFrame == true
                        val hasGesture = request?.hasGesture() == true
                        slog("override phase=$phase ${redactKulonCaptureLocation(target)}")
                        // Block anything not part of the SSO/Microsoft sign-in;
                        // the WebView simply stays on the current page.
                        if (!isAllowedLoginHost(host)) return true
                        if (isMicrosoftAuthorize(target)) seenMicrosoft = true
                        if (!mainFrame) return false
                        // The user may only interact with credential pages. A
                        // tap that would navigate away from them (reset
                        // password, registration, terms, ...) is ignored; every
                        // real hop in the cascade is a server redirect (no
                        // gesture) and still runs.
                        if (hasGesture && !isLoginInteractionAllowed(target)) {
                            slog("blocked user navigation off credential page")
                            return true
                        }
                        // A blocked navigation must not move the lock state: the
                        // WebView stays where it is, so the tracked URL must too.
                        if (target != null) currentUrl = target
                        return false
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?,
                    ) {
                        super.onReceivedError(view, request, error)
                        if (done || request?.isForMainFrame != true) return
                        val code = error?.errorCode ?: WebViewClient.ERROR_UNKNOWN
                        // Chromium reports aborted/superseded loads as
                        // ERROR_UNKNOWN; only real load failures are terminal.
                        if (code == WebViewClient.ERROR_UNKNOWN) return
                        slog("onReceivedError code=$code")
                        fail(LOGIN_LOAD_FAILED_MESSAGE)
                    }

                    override fun onReceivedHttpError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        errorResponse: WebResourceResponse?,
                    ) {
                        super.onReceivedHttpError(view, request, errorResponse)
                        if (done || request?.isForMainFrame != true) return
                        val code = errorResponse?.statusCode ?: 0
                        slog("onReceivedHttpError code=$code")
                        fail("Halaman login merespons dengan error (HTTP $code). Silakan ulangi.")
                    }
                }
            loadUrl(LoginUrls.SSO_LOGIN)
        }

    // Interaction is locked from the moment the browser leaves a credential
    // page until the handoff finishes (or the user restarts).
    val locked = !isLoginInteractionAllowed(currentUrl)

    // Watchdog for the automatic part of the cascade. `currentUrl` is a key so
    // every observable navigation restarts the timer: it measures one stalled
    // hop, not the user's typing time on the credential pages.
    LaunchedEffect(webViewKey, phase, currentUrl) {
        if (done || !locked) return@LaunchedEffect
        delay(LOGIN_STALL_TIMEOUT_MS)
        if (!done && error == null) {
            slog("cascade stall p$phase")
            webView?.stopLoading()
            fail("Login tidak selesai dalam batas waktu. Periksa koneksi lalu ulangi.")
        }
    }

    // The credential step is over: drop focus + the soft keyboard so leftover
    // typing cannot reach a page the user is no longer allowed to touch.
    LaunchedEffect(locked, webView) {
        if (!locked) return@LaunchedEffect
        webView?.clearFocus()
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(webView?.windowToken, 0)
    }

    Scaffold { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            key(webViewKey) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = ::createLoginWebView,
                    onRelease = { view ->
                        view.stopLoading()
                        view.destroy()
                    },
                )
            }

            // Thin load indicator while the user is still on the credential step.
            if (loading && !locked && error == null) {
                LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            }

            if (error != null) {
                LoginErrorOverlay(
                    message = error.orEmpty(),
                    onRetry = ::retryLogin,
                    onRestart = ::restartLogin,
                )
            } else if (locked) {
                LoginProgressOverlay(onRetry = ::restartLogin)
            } else {
                // Escape hatch on the credential step (hung page, wrong account,
                // broken SSO session): always reachable, no error required.
                Surface(
                    modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                    tonalElevation = 3.dp,
                ) {
                    TextButton(onClick = ::restartLogin) { Text("Ulangi") }
                }
            }
        }
    }
}

/**
 * Full-screen scrim that swallows every pointer event, so nothing reaches the
 * WebView underneath while the automatic part of the login runs.
 *
 * Consumption happens on the [PointerEventPass.Main] pass on purpose: that pass
 * walks a hit path child-first, so the scrim's OWN buttons (Ulangi login /
 * Coba lagi) still receive their taps, while everything else is consumed before
 * the WebView (a sibling behind the scrim) can act on it. Consuming on Initial
 * would run parent-first and silently swallow the buttons' taps.
 */
@Composable
private fun BlockingScrim(content: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.96f))
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Main).changes.forEach { it.consume() }
                    }
                }
            },
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

/** Automatic cascade in progress: the user waits, but can always restart. */
@Composable
private fun LoginProgressOverlay(onRetry: () -> Unit) {
    BlockingScrim {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text(
            "Menyelesaikan login otomatis…",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Sesi SSO sedang dialihkan ke Kulon dan SIAP. Jangan tutup aplikasi sampai selesai.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        TextButton(onClick = onRetry) { Text("Ulangi login") }
    }
}

/** Terminated login: cheap step retry first, clean restart as the fallback. */
@Composable
private fun LoginErrorOverlay(
    message: String,
    onRetry: () -> Unit,
    onRestart: () -> Unit,
) {
    BlockingScrim {
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onRetry) { Text("Coba lagi") }
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = onRestart) { Text("Ulangi dari awal") }
    }
}
