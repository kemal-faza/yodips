package ac.undip.sso.ui

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.SessionExpiredEvents
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import android.webkit.CookieManager
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/**
 * Top-level: no-token → Login (WebView handoff); token → AppShell (5-tab).
 */
@Composable
fun AppRoot(
    tokenStore: TokenStore,
    themeController: ThemeController,
) {
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    // Hoisted to the root so its coroutines are NOT cancelled when the AppShell
    // branch is disposed — otherwise tokenStore.clear() gets cancelled mid-write
    // on logout and the persisted session survives a process restart.
    val scope = rememberCoroutineScope()

    // Read the stored JWT once on startup and reattach it to the HTTP client
    // so Retrofit sends `Authorization: Bearer` on every data call.
    LaunchedEffect(tokenStore) {
        val t = tokenStore.currentToken()
        if (t != null) ApiClient.authToken = t
        hasToken = t != null
        checked = true
    }

    if (!checked) return

    // Hoisted so both AppShell and the session-expired dialog can trigger it.
    // Clears persisted session, HTTP bearer, any WebView session cookies, and
    // the session-expired signal so the next login starts fresh (not
    // auto-attached to the old part).
    val onLogout: () -> Unit = {
        ApiClient.authToken = null
        scope.launch { tokenStore.clear() }
        runCatching { CookieManager.getInstance().removeAllCookies(null) }
        SessionExpiredEvents.consume()
        hasToken = false
    }

    if (hasToken) {
        AppShell(
            themeController = themeController,
            onLogout = onLogout,
        )
    } else {
        LoginScreen(
            onLoggedIn = { hasToken = true },
            tokenStore = tokenStore,
        )
    }

    // Universal "session expired" dialog: fired by SsoRepository on ANY 401
    // (expired JWT or backend lost the upstream session), so a dead session
    // surfaces immediately instead of silently serving stale cache. It only
    // shows while the user is logged in (events are ignored post-logout), is
    // non-dismissible — the session is dead, the only way forward is re-login —
    // and its CTA reuses the normal logout path so the next login starts clean.
    val sessionExpired by SessionExpiredEvents.events.collectAsState()
    if (hasToken && sessionExpired > 0) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Sesi Berakhir") },
            text = {
                Text("Sesi login kamu sudah tidak valid. Klik Login Ulang untuk masuk kembali.")
            },
            confirmButton = {
                TextButton(onClick = onLogout) {
                    Text("Login Ulang")
                }
            },
        )
    }
}
