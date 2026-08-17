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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val themeController = remember { ThemeController(applicationContext) }
            UndipSSOTheme(darkTheme = themeController.dark) {
                val tokenStore = remember { TokenStore(applicationContext) }
                AppRoot(tokenStore, themeController)
            }
        }
    }
}
