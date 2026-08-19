package ac.undip.sso

import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.UndipSSOTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    val tokenStore = remember { TokenStore(applicationContext) }
                    AppRoot(tokenStore, themeController)
                }
            }
        }
    }
}
