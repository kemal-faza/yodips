package ac.undip.sso.ui

import ac.undip.sso.core.data.NoOpPersistentCache
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import androidx.compose.runtime.*
import kotlinx.coroutines.launch

@Composable
fun AppRoot() {
    val tokenStore = remember { TokenStore() }
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    val themeController = remember { ThemeController({ false }, {}) }

    LaunchedEffect(tokenStore) {
        val t = tokenStore.currentToken()
        if (t != null) Backend.authToken = t
        hasToken = t != null
        checked = true
    }

    if (!checked) return

    if (hasToken) {
        AppShell(
            tokenStore = tokenStore,
            persistentCache = NoOpPersistentCache,
            themeController = themeController,
            onLogout = {
                Backend.authToken = null
                kotlinx.coroutines.GlobalScope.launch { tokenStore.clear() }
                hasToken = false
            },
        )
    } else {
        LoginScreen(
            tokenStore = tokenStore,
            onLoggedIn = { hasToken = true },
        )
    }
}