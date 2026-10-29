package ac.undip.sso.ui.common

import ac.undip.sso.core.network.UpstreamSessionService
import ac.undip.sso.ui.navigation.LocalRequireLogin
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

internal fun staleServiceLabel(service: UpstreamSessionService): String =
    when (service) {
        UpstreamSessionService.KULON -> "Kulon"
        UpstreamSessionService.SIAP -> "SIAP"
    }

@Composable
fun StaleSessionState(
    service: UpstreamSessionService,
    onLogin: () -> Unit = LocalRequireLogin.current,
    modifier: Modifier = Modifier,
) {
    val label = staleServiceLabel(service)
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(24.dp),
        ) {
            Text(
                "Sesi $label berakhir",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                "Login ulang lewat SSO untuk melanjutkan. Data layanan lain tetap bisa dipakai.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onLogin) { Text("Login ulang") }
        }
    }
}
