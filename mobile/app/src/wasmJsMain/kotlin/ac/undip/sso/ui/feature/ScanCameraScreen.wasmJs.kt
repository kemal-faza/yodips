package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.scan.CameraRegion
import ac.undip.sso.core.scan.QrScanResult
import ac.undip.sso.core.scan.QrScanner
import ac.undip.sso.ui.navigation.LocalAppNavigation
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
internal actual fun ScanScreen(repo: SsoRepository) {
    var outcome by remember { mutableStateOf<ScanOutcome?>(null) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var scanningBusy by remember { mutableStateOf(false) }
    var region by remember { mutableStateOf<CameraRegion?>(null) }
    val scope = rememberCoroutineScope()
    val nav = LocalAppNavigation.current
    val density = LocalDensity.current.density

    fun startScan() {
        if (scanningBusy) return
        scanningBusy = true
        cameraError = null
        outcome = null
        scope.launch {
            when (val result = QrScanner.scanOnce(region)) {
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

    // Ukur area konten setelah layout, lalu mulai scan hanya sekali.
    LaunchedEffect(region) {
        if (region != null && !scanningBusy) startScan()
    }

    // Bridge back device/browser → Dashboard. Saat layar scan terbuka, push satu
    // entry history dummy; back device/browser memicu popstate → onNavigateDashboard.
    // Listener di-register/deregister oleh JS helper yang menyimpan handler di
    // window (single-slot) supaya removeEventListener punya referensi yang sama.
    DisposableEffect(nav) {
        jsInstallBackBridge(onPop = { nav?.onNavigateDashboard() })
        jsPushState()
        onDispose { jsUninstallBackBridge() }
    }

    FeatureScreen(title = "Scan QR", onBack = { nav?.onNavigateDashboard() }) {
        Box(
            Modifier
                .fillMaxSize()
                .onGloballyPositioned { coords ->
                    if (region == null) {
                        val b = coords.boundsInWindow()
                        region = CameraRegion(
                            left = (b.left / density).roundToInt(),
                            top = (b.top / density).roundToInt(),
                            width = (b.width / density).roundToInt(),
                            height = (b.height / density).roundToInt(),
                        )
                    }
                },
        ) {
            when {
                cameraError != null -> {
                    var manualToken by remember { mutableStateOf("") }
                    Column(Modifier.fillMaxSize().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
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
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { startScan() }, enabled = !scanningBusy) {
                            Text("Coba Kamera Lagi")
                        }
                    }
                }

                outcome != null -> {
                    val o = outcome!!
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
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
                                startScan()
                            }) {
                                Text("Scan Lagi")
                            }
                        }
                    }
                }

                // Kamera overlay DOM (Task 2) menutup area konten saat scan berjalan.
                scanningBusy -> {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
            }
        }
    }
}

// ---------- bridge back device/browser (wasm) ----------
// Handler disimpan di single-slot window.__ydPopHandler supaya
// jsUninstallBackBridge bisa removeEventListener dengan referensi yang sama.

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(onPop) => {" +
        "var h = window.__ydPopHandler;" +
        "if (h) window.removeEventListener('popstate', h);" +
        "h = function(){ onPop(); };" +
        "window.__ydPopHandler = h;" +
        "window.addEventListener('popstate', h);" +
        "}",
)
private external fun jsInstallBackBridge(onPop: () -> Unit)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "() => {" +
        "var h = window.__ydPopHandler;" +
        "if (h) { window.removeEventListener('popstate', h); window.__ydPopHandler = null; }" +
        "}",
)
private external fun jsUninstallBackBridge()

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => { history.pushState({ ydScan: true }, ''); }")
private external fun jsPushState()
