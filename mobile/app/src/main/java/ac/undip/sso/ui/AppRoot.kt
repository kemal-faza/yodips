package ac.undip.sso.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell

/**
 * Top-level: no-token → Login (WebView handoff); token → AppShell (5-tab).
 */
@Composable
fun AppRoot(tokenStore: TokenStore) {
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }

    // Read the stored JWT once on startup.
    LaunchedEffect(tokenStore) {
        hasToken = tokenStore.currentToken() != null
        checked = true
    }

    if (!checked) return

    if (hasToken) {
        AppShell()
    } else {
        LoginScreen(
            onLoggedIn = { hasToken = true },
            tokenStore = tokenStore,
        )
    }
}
