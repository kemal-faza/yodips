package ac.undip.sso.ui.feature

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

@Composable
fun PushOptInDialog(
    visible: Boolean,
    onEnable: () -> Unit,
    onLater: () -> Unit,
) {
    if (!visible) return
    AlertDialog(
        onDismissRequest = onLater,
        title = { Text("Aktifkan notifikasi?") },
        text = { Text("Dapatkan notifikasi tugas baru dan perubahan jadwal.") },
        confirmButton = { TextButton(onClick = onEnable) { Text("Aktifkan") } },
        dismissButton = { TextButton(onClick = onLater) { Text("Nanti") } },
    )
}
