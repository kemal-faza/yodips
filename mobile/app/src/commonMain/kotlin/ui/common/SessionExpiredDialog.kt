package ac.undip.sso.ui.common

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

/**
 * Universal non-dismissible re-login dialog for an explicit SESSION_DEAD.
 * Only the "Login Ulang" action is available; the session is terminal.
 */
@Composable
fun SessionExpiredDialog(
    visible: Boolean,
    onRelogin: () -> Unit,
) {
    if (!visible) return
    AlertDialog(
        onDismissRequest = {},
        title = { Text("Sesi Berakhir") },
        text = {
            Text("Sesi login kamu sudah tidak valid. Klik Login Ulang untuk masuk kembali.")
        },
        confirmButton = {
            TextButton(onClick = onRelogin) {
                Text("Login Ulang")
            }
        },
    )
}
