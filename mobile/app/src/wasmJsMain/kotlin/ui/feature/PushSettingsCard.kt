package ac.undip.sso.ui.feature

import ac.undip.sso.core.push.PushSettingsController
import ac.undip.sso.core.push.PushState
import ac.undip.sso.ui.theme.AppCard
import ac.undip.sso.ui.theme.AppElevation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun PushSettingsCard(controller: PushSettingsController) {
    val state by controller.state.collectAsState()
    val scope = rememberCoroutineScope()
    AppCard(
        level = AppElevation.Lifted,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Notifikasi", style = MaterialTheme.typography.titleMedium)
            when (val s = state) {
                PushState.Unsupported -> Text("Browser ini tidak mendukung notifikasi push.")
                PushState.VapidUnavailable -> Text("Notifikasi belum tersedia dari server.")
                PushState.PermissionDefault -> {
                    Text("Aktifkan notifikasi untuk tugas dan jadwal.")
                    Button(onClick = { scope.launch { controller.enable() } }) { Text("Aktifkan") }
                }
                PushState.PermissionDenied -> Text("Notifikasi diblokir. Buka pengaturan situs di browser untuk mengizinkannya.")
                PushState.NotSubscribed -> {
                    Text("Notifikasi belum aktif di perangkat ini.")
                    Button(onClick = { scope.launch { controller.enable() } }) { Text("Aktifkan") }
                }
                is PushState.Subscribed -> {
                    Text("Notifikasi aktif untuk tugas dan jadwal.")
                    Button(onClick = { scope.launch { controller.disable() } }) { Text("Matikan") }
                }
                PushState.Working -> CircularProgressIndicator()
                is PushState.Error -> {
                    Text(s.message, color = MaterialTheme.colorScheme.error)
                    Button(onClick = { scope.launch { controller.refresh() } }) { Text("Coba lagi") }
                }
            }
        }
    }
}
