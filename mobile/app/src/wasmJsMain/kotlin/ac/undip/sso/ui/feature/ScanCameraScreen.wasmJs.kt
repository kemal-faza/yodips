package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.scan.QrScanResult
import ac.undip.sso.core.scan.QrScanner
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal actual fun ScanScreen(repo: SsoRepository) {
    var outcome by remember { mutableStateOf<ScanOutcome?>(null) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var scanningBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun startScan() {
        if (scanningBusy) return
        scanningBusy = true
        cameraError = null
        scope.launch {
            when (val result = QrScanner.scanOnce()) {
                is QrScanResult.Success -> {
                    val submit = repo.markKehadiran(result.token)
                    outcome = scanOutcome(submit)
                }

                is QrScanResult.Error -> cameraError = result.message
                // User menutup scanner sendiri - kembali tanpa pesan.
                QrScanResult.Cancelled -> Unit
            }
            scanningBusy = false
        }
    }

    // Harness E2E / shortcut user: ?scan=1 memulai pemindaian otomatis saat
    // layar dibuka (paritas perilaku dgn Android yang langsung aktifkan kamera).
    LaunchedEffect(Unit) {
        if (jsUrlSearchParams("scan") == "1") startScan()
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Scan QR Absensi", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        if (cameraError != null) {
            var manualToken by remember { mutableStateOf("") }
            Text(cameraError!!, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = manualToken,
                onValueChange = { manualToken = it },
                label = { Text("Token QR (manual)") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    capitalization = KeyboardCapitalization.Characters,
                ),
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    cursorColor = MaterialTheme.colorScheme.primary,
                ),
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
        } else {
            // Kamera belum dicoba/gagal belum terjadi - tampilkan tombol pindai.
            Button(onClick = { startScan() }, enabled = !scanningBusy) {
                Text(if (scanningBusy) "Memindai…" else "Scan QR")
            }
        }

        if (scanningBusy) {
            Spacer(Modifier.height(16.dp))
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
                        cameraError = null
                    }) {
                        Text("Scan Lagi")
                    }
                }
            }
        }
    }
}

@JsFun("(key) => { const p = new URLSearchParams(window.location.search); return p.get(key); }")
private external fun jsUrlSearchParams(key: String): String?