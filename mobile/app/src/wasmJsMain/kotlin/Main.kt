package ac.undip.sso

import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.UndipSSOTheme
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    // Satu ThemeController dibagi theme top-level & ProfileScreen toggle.
    // Default = preferensi sistem (prefers-color-scheme), persist di localStorage
    // — parity dengan web store (`theme`).
    val themeController = ThemeController(
        defaultDark = ::jsSystemPrefersDark,
        persist = ::jsPersistTheme,
    )
    ComposeViewport {
        UndipSSOTheme(darkTheme = themeController.dark) {
            AppRoot(themeController = themeController)
        }
    }
}

@JsFun("() => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches")
private external fun jsSystemPrefersDark(): Boolean

@JsFun("(dark) => { try { localStorage.setItem('yodips_theme', dark ? 'dark' : 'light'); } catch (e) {} }")
private external fun jsPersistTheme(dark: Boolean)
