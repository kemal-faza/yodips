package ac.undip.sso.ui.login

import ac.undip.sso.BuildConfig
import ac.undip.sso.core.login.LoginUrls
import ac.undip.sso.core.login.generateSsoTicket
import ac.undip.sso.core.login.isAllowedLoginHost
import ac.undip.sso.core.login.isAuthenticatedKulonUrl
import ac.undip.sso.core.login.isAuthenticatedSiapUrl
import ac.undip.sso.core.login.isMicrosoftAuthorize
import ac.undip.sso.core.login.isSsoLoginPage
import ac.undip.sso.core.login.kulonTicketUrl
import ac.undip.sso.core.login.siapTicketUrl
import ac.undip.sso.core.login.ssoLoginCompleted
import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.HandoffResult
import ac.undip.sso.core.data.TokenStoreLike
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch

/**
 * JS normalizer injected into the SSO login page on finish (see CHECKPOINT Path A
 * spike): the in-app WebView fails to paint the official SSO login card (it loads
 * off-screen at y≈-295 and under a fixed full-screen `.bg-image` blur; the
 * EnjoyHint onboarding overlay also covers it). This shim — validated live via
 * CDP: input paints and is hit-testable — fixes the layout so the user can log in:
 *  - hide the decorative fixed `.bg-image` cover,
 *  - pin the login `.card` to a visible fixed position (white, on top),
 *  - remove the EnjoyHint onboarding overlay + mark it done in localStorage.
 * Idempotent; safe to run on every SSO page finish.
 */
private const val SSO_LAYOUT_SHIM =
    """
(function(){
  var st=document.getElementById('undip-fix');
  if(!st){st=document.createElement('style');st.id='undip-fix';document.head.appendChild(st);}
  st.textContent=
    'div.bg-image{display:none!important}'+
    'body{overflow:auto!important}'+
    'div.card{position:fixed!important;top:150px!important;left:50%!important;margin-left:-190px!important;width:380px!important;z-index:2147483647!important;background:#ffffff!important;box-shadow:0 6px 24px rgba(0,0,0,.25)!important;border-radius:12px!important;padding:24px!important;transform:none!important}'+
    'div.card .card-body,div.card .card-content,div.card form{margin:0!important;padding:0!important;background:transparent!important}'+
    '.enjoyhint_skip_btn,.enjoyhint_next_btn,.enjoyhint_close_btn,#enjoyhint{display:none!important}';
  document.querySelectorAll('#enjoyhint,[class*="enjoyhint"]').forEach(function(e){e.remove();});
  try{localStorage.setItem('intro_tour_login', JSON.stringify({intro_tour_login_isDone:true}));}catch(e){}
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
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var phase by remember { mutableIntStateOf(0) } // 0=SSO,1=Kulon,2=SIAP,3=handoff
    var seenMicrosoft by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

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

    /** Handoff runs once from the SIAP hop (phase 2 finished); guarded by phase. */
    fun doHandoff(
        view: WebView,
        siap: String,
        kulon: String,
    ) {
        if (phase != 2) return
        phase = 3
        loading = true
        slog("handoff siap=${siap.isNotBlank()} kulon=${kulon.isNotBlank()}")
        scope.launch {
            when (val r = ApiClient.handoff(siap, kulon)) {
                is HandoffResult.Success -> {
                    slog("handoff OK")
                    ApiClient.authToken = r.token
                    tokenStore.save(r.token, siap, kulon)
                    onLoggedIn()
                }

                is HandoffResult.Failure -> {
                    slog("handoff FAIL: ".plus(r.reason.take(160)))
                    loading = false
                    error = r.reason
                    phase = 2 // allow retry by re-loading SIAP
                }
            }
        }
    }

    fun reset() {
        phase = 0
        seenMicrosoft = false
        error = null
        loading = false
        webView?.loadUrl(LoginUrls.SSO_LOGIN)
    }

    // Start the cascade once the WebView exists.
    LaunchedEffect(Unit) { reset() }

    Scaffold { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            AndroidView(
                factory = { ctx ->
                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    WebView(ctx).apply {
                        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadsImagesAutomatically = true
                        // No local files ever need to load; blocking file access
                        // closes a file:// exfiltration/JS vector in the WebView.
                        settings.setAllowFileAccess(false)
                        webViewClient =
                            object : WebViewClient() {
                                override fun onPageStarted(
                                    view: WebView?,
                                    url: String?,
                                    favicon: Bitmap?,
                                ) {
                                    super.onPageStarted(view, url, favicon)
                                    slog("onPageStarted p$phase $url")
                                    loading = true
                                    // A hop through Microsoft marks a real sign-in round-trip.
                                    if (isMicrosoftAuthorize(url)) seenMicrosoft = true
                                }

                                override fun onPageFinished(
                                    view: WebView?,
                                    url: String?,
                                ) {
                                    super.onPageFinished(view, url)
                                    slog("onPageFinished p$phase $url")
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
                                                capture("sso.undip.ac.id", "ci_session_sso") != null,
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
                                            capture("siap.undip.ac.id", "sia_app_session") != null
                                        -> {
                                            val siap = captureAll("siap.undip.ac.id").orEmpty()
                                            val kulon = captureAll("kulon2.undip.ac.id").orEmpty()
                                            doHandoff(view!!, siap, kulon)
                                        }
                                    }
                                }

                                override fun shouldOverrideUrlLoading(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                ): Boolean {
                                    val host = request?.url?.host.orEmpty()
                                    slog("override host=$host phase=$phase")
                                    // Block anything not part of the SSO/Microsoft sign-in.
                                    if (!isAllowedLoginHost(host)) return true
                                    if (isMicrosoftAuthorize(request?.url?.toString())) seenMicrosoft = true
                                    return false
                                }
                            }
                        webView = this
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            when {
                error != null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            error ?: "",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                        Spacer(Modifier.height(16.dp))
                        Button(onClick = { reset() }) {
                            Text("Coba lagi")
                        }
                    }
                }

                loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
            }
        }
    }
}
