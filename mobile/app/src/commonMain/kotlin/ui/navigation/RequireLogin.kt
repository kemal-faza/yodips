package ac.undip.sso.ui.navigation

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Clean re-login callback provided by AppShell. Screens use it from
 * StaleSessionState; AppRoot owns the actual logout/token/WebView cleanup.
 */
val LocalRequireLogin = staticCompositionLocalOf<() -> Unit> { {} }
