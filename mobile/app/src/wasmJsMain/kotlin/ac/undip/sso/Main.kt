package ac.undip.sso

import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.UndipSSOTheme
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    ComposeViewport {
        UndipSSOTheme {
            AppRoot()
        }
    }
}