package ac.undip.sso

import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.UndipSSOTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 15 enforces edge-to-edge for targetSdk 35. Make the system
        // bars transparent, then let Compose consume the safe-area insets.
        enableEdgeToEdge()
        setContent {
            val themeController = remember { ThemeController(applicationContext) }
            UndipSSOTheme(darkTheme = themeController.dark) {
                SideEffect {
                    WindowCompat.getInsetsController(window, window.decorView).apply {
                        isAppearanceLightStatusBars = !themeController.dark
                        isAppearanceLightNavigationBars = !themeController.dark
                    }
                }
                val tokenStore = remember { TokenStore(applicationContext) }
                AppRoot(tokenStore, themeController)
            }
        }
    }
}
