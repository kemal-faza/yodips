package ac.undip.sso

import ac.undip.sso.core.push.PushGraph
import ac.undip.sso.core.push.ensureAkademikChannel
import ac.undip.sso.core.push.normalizeNavTarget
import ac.undip.sso.core.session.KeystoreTokenCipher
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.core.session.tokenDataStore
import ac.undip.sso.ui.AppRoot
import ac.undip.sso.ui.theme.platformThemeController
import ac.undip.sso.ui.theme.UndipSSOTheme
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val navTargetFlow = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        ensureAkademikChannel(this)
        PushGraph.install(this)
        navTargetFlow.value = normalizeNavTarget(intent?.getStringExtra("target"))
        setContent {
            val themeController = remember { platformThemeController(applicationContext) }
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
                    val tokenStore = remember {
                        // Token data is encrypted at rest with an Android-KeyStore-backed
                        // AES key (KeystoreTokenCipher) — never stored as plaintext.
                        TokenStore(applicationContext.tokenDataStore, KeystoreTokenCipher(applicationContext))
                    }
                    val pendingNavTarget by navTargetFlow.collectAsState()
                    AppRoot(
                        tokenStore,
                        themeController,
                        pendingNavTarget = pendingNavTarget,
                        onNavConsumed = { navTargetFlow.value = null },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        navTargetFlow.value = normalizeNavTarget(intent.getStringExtra("target"))
    }
}
