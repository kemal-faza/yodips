package ac.undip.sso.ui

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import android.webkit.CookieManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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

    if (hasToken) {
        val onLogout: () -> Unit = {
            // Clear persisted session, HTTP bearer, and any WebView session cookies
            // so the next login starts fresh (not auto-attached to the old part).
            ApiClient.authToken = null
            scope.launch { tokenStore.clear() }
            runCatching { CookieManager.getInstance().removeAllCookies(null) }
            hasToken = false
        }
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
}
