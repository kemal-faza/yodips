package ac.undip.sso.ui.feature

import ac.undip.sso.core.push.NotificationHistoryStore
import ac.undip.sso.core.push.StoredNotification
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

/**
 * Daftar notifikasi push yang pernah diterima perangkat (disimpan lokal).
 * Menampilkan title/body + waktu terima; baru bisa dibersihkan via tombol
 * "Bersihkan" di header. Layar sub (punya tombol kembali).
 */
@Composable
fun NotificationsScreen(
    history: NotificationHistoryStore,
    onBack: () -> Unit,
) {
    var items by remember { mutableStateOf<List<StoredNotification>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { items = history.all() }

    FeatureScreen("Notifikasi", onBack = onBack, headerAction = {
        if (items.isNotEmpty()) {
            TextButton(onClick = { scope.launch { history.clear(); items = emptyList() } }) {
                Text("Bersihkan")
            }
        }
    }) {
        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(
                        Icons.Outlined.Notifications,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    Text(
                        "Belum ada notifikasi.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(items, key = { it.id }) { n ->
                    NotificationCard(n)
                }
            }
        }
    }
}

@Composable
private fun NotificationCard(n: StoredNotification) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                n.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            if (n.body.isNotBlank()) {
                Text(
                    n.body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (n.receivedAt > 0) {
                Text(
                    "Diterima: ${epochToDate(n.receivedAt / 1000)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
