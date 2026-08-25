package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal actual fun ScanScreen(repo: SsoRepository) {
    var outcome by remember { mutableStateOf<ScanOutcome?>(null) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var scanning by remember { mutableStateOf(true) }
    var scanningBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Scan QR Absensi", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        if (cameraError != null && !scanning) {
            var manualToken by remember { mutableStateOf("") }
            Text(cameraError!!, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = manualToken,
                onValueChange = { manualToken = it },
                label = { Text("Token QR (manual)") },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                if (manualToken.isNotBlank()) {
                    scanningBusy = true
                    scope.launch {
                        val result = repo.markKehadiran(manualToken.trim())
                        outcome = scanOutcome(result)
                        scanningBusy = false
                    }
                }
            }, enabled = manualToken.isNotBlank() && !scanningBusy) {
                Text("Kirim")
            }
        }

        Spacer(Modifier.height(16.dp))

        if (scanning && !scanningBusy) {
            Button(onClick = {
                scanningBusy = true
                scope.launch {
                    try {
                        // TODO(F4): Implement jsQR camera scanner
                        cameraError = "Kamera QR belum tersedia. Gunakan input manual."
                        scanning = false
                    } finally {
                        scanningBusy = false
                    }
                }
            }) {
                Text("Scan QR")
            }
        }

        if (scanningBusy) {
            CircularProgressIndicator()
        }

        Spacer(Modifier.height(16.dp))

        outcome?.let { o ->
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (o.success)
                        MaterialTheme.colorScheme.primaryContainer
                    else
                        MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        if (o.success) "Absen Berhasil" else "Gagal",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(o.message)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = {
                        outcome = null
                        scanning = true
                        cameraError = null
                    }) {
                        Text("Scan Lagi")
                    }
                }
            }
        }
    }
}