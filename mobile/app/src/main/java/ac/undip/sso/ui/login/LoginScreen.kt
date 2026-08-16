package ac.undip.sso.ui.login

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.HandoffResult
import ac.undip.sso.core.session.TokenStore
import kotlinx.coroutines.launch

/**
 * In-app WebView login with a single-tab cascade:
 *   SSO (sso.undip.ac.id) → Kulon (kulon2.undip.ac.id) → SIAP (siap.undip.ac.id)
 * Each hop navigates the SAME WebView so the shared CookieManager collects every
 * session cookie. On completion we capture the cookies, POST handoff, store the
 * JWT, and `onLoggedIn()`. Credentials never reach our backend.
 *
 * This is the in-app WebView design locked in docs/CHECKPOINT.md (2026-08-06);
 * it replaces the desktop CDP/extension path for mobile.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    tokenStore: TokenStore,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var loading by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf("Membuka halaman SSO…") }
    var phase by remember { mutableIntStateOf(0) } // 0=SSO,1=Kulon,2=SIAP,3=handoff

    // Handoff runs once from the SIAP hop (phase 2 finished); guarded by phase.
    fun doHandoff(view: WebView, siap: String, kulon: String) {
        if (phase != 2) return
        phase = 3
        loading = true
        status = "Menyinkronkan sesi…"
        scope.launch {
            when (val r = ApiClient.handoff(siap, kulon)) {
                is HandoffResult.Success -> {
                    tokenStore.save(r.token, siap, kulon)
                    onLoggedIn()
                }
                is HandoffResult.Failure -> {
                    loading = false
                    status = r.reason
                    phase = 2 // allow retry by re-loading SIAP
                }
            }
        }
    }

    fun capture(host: String, name: String): String? =
        CookieManager.getInstance().getCookie("https://$host")?.let { all ->
            all.split(";").firstOrNull { it.trimStart().startsWith("$name=") }?.substringAfter("=")?.trim()
        }

    Scaffold { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            AndroidView(
                factory = { ctx ->
                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadsImagesAutomatically = true
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                loading = true
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                                loading = false
                                when {
                                    phase == 0 && capture("sso.undip.ac.id", "ci_session_sso") != null -> {
                                        phase = 1
                                        status = "Berpindah ke Kulon…"
                                        view?.loadUrl("https://kulon2.undip.ac.id/my/")
                                    }
                                    phase == 1 && capture("kulon2.undip.ac.id", "MoodleSession") != null -> {
                                        phase = 2
                                        status = "Berpindah ke SIAP…"
                                        view?.loadUrl("https://siap.undip.ac.id/pages/mhs/dashboard")
                                    }
                                    phase == 2 && capture("siap.undip.ac.id", "sia_app_session") != null -> {
                                        val siap = capture("siap.undip.ac.id", "sia_app_session")!!
                                        val kulon = capture("kulon2.undip.ac.id", "MoodleSession")
                                        doHandoff(view!!, siap, kulon.orEmpty())
                                    }
                                }
                            }

                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val host = request?.url?.host.orEmpty()
                                return !host.endsWith("undip.ac.id")
                            }
                        }
                        loadUrl("https://sso.undip.ac.id/user/login")
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            if (loading) {
                Column(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator()
                    Text(status, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}
