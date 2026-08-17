package ac.undip.sso.ui.feature

import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * QR presence scan. CameraX + MLKit barcode decoder is a later slice (C3);
 * the Scan tab (raised teal FAB) currently lands here. The token contract is
 * already live on the backend: `POST /api/siap/kehadiran {token}` (SsoRepository).
 */
@Composable
fun ScanScreen() {
    FeatureScreen(title = "Scan QR") {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(40.dp))
            Icon(
                Icons.Filled.QrCodeScanner,
                contentDescription = null,
                tint = accentForeground(),
                modifier = Modifier.size(320.dp),
            )
            Spacer(Modifier.height(16.dp))
            Text(
                "Pindai QR absensi yang ditampilkan dosen.",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Kamera akan aktif pada rilis berikutnya. Token QR sudah diproses via API kehadiran.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
