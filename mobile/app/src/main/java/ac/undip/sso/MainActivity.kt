package ac.undip.sso

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.UndipSSOTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            UndipSSOTheme {
                val tokenStore = remember { TokenStore(applicationContext) }
                AppRoot(tokenStore)
            }
        }
    }
}