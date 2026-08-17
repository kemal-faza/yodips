package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.ui.theme.Primary
import ac.undip.sso.ui.theme.accentForeground
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Result of interpreting a presence (absen) attendance response, for surfacing
 * in the QR scan UI. Pure so it is unit-testable without camera/network.
 */
data class ScanOutcome(
    val success: Boolean,
    val message: String,
)

/**
 * Map the backend presence-proxy result ([SsoRepository.markKehadiran]) to a
 * concise user-facing outcome. The backend passes through SIAP's own message
 * for a business rejection (e.g. an expired/consumed QR); the /me-grade failures
 * (no-session, network, 5xx) get a generic prompt.
 */
fun scanOutcome(
    result: ApiResult<KehadiranResponse>,
    fallback: String = "Gagal mencatat kehadiran.",
): ScanOutcome =
    when (result) {
        is ApiResult.Success -> {
            val ok = result.data.status == "success" || result.data.status.isBlank()
            val msg =
                result.data.message?.takeIf { it.isNotBlank() }
                    ?: if (ok) {
                        "Absensi berhasil dicatat. ✅"
                    } else {
                        "QR ditolak SIAP. Mungkin sudah kedaluwarsa atau sudah dipakai."
                    }
            ScanOutcome(success = ok, message = msg)
        }

        is ApiResult.Error -> {
            when (result.type) {
                ErrorType.UNAUTHORIZED -> {
                    ScanOutcome(false, "Sesi berakhir. Silakan login ulang.")
                }

                ErrorType.NETWORK -> {
                    ScanOutcome(false, "Tidak dapat terhubung ke server.")
                }

                ErrorType.UPSTREAM -> {
                    ScanOutcome(
                        false,
                        result.message.takeIf { it.isNotBlank() }
                            ?: "Kode QR tidak valid atau sudah kedaluwarsa.",
                    )
                }

                ErrorType.STALE_SESSION -> {
                    ScanOutcome(false, "Sesi SIAP kedaluwarsa. Silakan login ulang.")
                }

                ErrorType.NOT_FOUND, ErrorType.SERVER -> {
                    ScanOutcome(false, fallback)
                }
            }
        }
    }

/**
 * QR presence scanner. Live CameraX preview; each frame is pushed through the
 * MLKit QR decoder. On the first QR token found the analysis is paused and the
 * token is POSTed to `POST /api/siap/kehadiran` (proxied to SIAP). The scan
 * frame + corner overlay guide alignment; a result card shows the outcome with
 * a "Scan lagi" reset.
 *
 * The barcode pipeline (MLKit/CameraX) is instrumented-only; the composable
 * testability lives in the pure [scanOutcome] mapping + [QrReader] gate.
 */
@Composable
fun ScanScreen(repo: SsoRepository) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var permissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var outcome by remember { mutableStateOf<ScanOutcome?>(null) }
    val processing = remember { AtomicBoolean(false) }

    val permissionLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permissionGranted = granted
        }

    // MLKit scanner + frame executor live for the whole screen lifetime.
    val scanner =
        remember {
            BarcodeScanning.getClient(
                BarcodeScannerOptions
                    .Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                    .build(),
            )
        }
    val scanExecutor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) {
        onDispose {
            scanner.close()
            scanExecutor.shutdown()
        }
    }

    val previewView =
        remember {
            PreviewView(context).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            }
        }

    // Bind/unbind the camera use cases. Re-binds whenever permission flips or an
    // outcome appears/disappears (so "Scan lagi" restarts the camera).
    DisposableEffect(permissionGranted, outcome) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val bind =
            Runnable {
                val provider = providerFuture.get()
                if (!permissionGranted || outcome != null) return@Runnable
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis =
                    ImageAnalysis
                        .Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                analysis.setAnalyzer(scanExecutor) { imageProxy ->
                    decodeQr(imageProxy, scanner, processing) { token ->
                        processing.set(true)
                        scope.launch {
                            outcome = scanOutcome(repo.markKehadiran(token))
                        }
                    }
                }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        providerFuture.addListener(bind, ContextCompat.getMainExecutor(context))
        onDispose {
            providerFuture.addListener(
                { if (providerFuture.isDone) providerFuture.get().unbindAll() },
                ContextCompat.getMainExecutor(context),
            )
        }
    }

    FeatureScreen(title = "Scan QR") {
        when {
            !permissionGranted -> {
                PermissionPrompt { permissionLauncher.launch(Manifest.permission.CAMERA) }
            }

            else -> {
                Column(Modifier.fillMaxSize()) {
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .background(Color.Black),
                    ) {
                        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                        ScanOverlay()
                    }
                    Spacer(Modifier.height(16.dp))
                    Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp)) {
                        if (outcome == null) {
                            Text(
                                "Arahkan QR absensi dari dosen ke dalam bingkai.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        } else {
                            OutcomeCard(outcome!!) {
                                outcome = null
                                processing.set(false)
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                }
            }
        }
    }
}

/** Guide frame drawn over the live preview. */
@Composable
private fun ScanOverlay() {
    Box(
        Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(260.dp)
                .border(3.dp, Primary, RoundedCornerShape(16.dp)),
        )
    }
}

@Composable
private fun OutcomeCard(
    outcome: ScanOutcome,
    onReset: () -> Unit,
) {
    val bg = if (outcome.success) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer
    val fg = if (outcome.success) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer
    Column(
        Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(16.dp))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(outcome.message, style = MaterialTheme.typography.bodyMedium, color = fg, textAlign = TextAlign.Center)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Button(onClick = onReset) {
                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Scan lagi")
            }
        }
    }
}

@Composable
private fun PermissionPrompt(onRequest: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Filled.QrCodeScanner,
            contentDescription = null,
            tint = accentForeground(),
            modifier = Modifier.size(96.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "Akses kamera diperlukan untuk memindai QR absensi.",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Kami hanya memakai kamera saat halaman scan terbuka; tidak ada data yang dikirim ke mana pun dari kameranya selain token QR.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onRequest) {
            Text("Berikan izin kamera")
        }
    }
}

/**
 * Run the MLKit QR decode on one camera frame and hand the first token to
 * [onToken]. Fully idempotent per-frame; the [processing] gate (thread-safe)
 * keeps us from firing duplicate presence calls while a previous call runs.
 */
private fun decodeQr(
    imageProxy: ImageProxy,
    scanner: BarcodeScanner,
    processing: AtomicBoolean,
    onToken: (String) -> Unit,
) {
    val mediaImage = imageProxy.image
    if (mediaImage != null && !processing.get()) {
        val input = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        scanner
            .process(input)
            .addOnSuccessListener { codes ->
                if (!processing.get()) {
                    val token =
                        codes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }?.rawValue
                    if (!token.isNullOrBlank()) {
                        processing.set(true)
                        onToken(token)
                    }
                }
            }.addOnCompleteListener { imageProxy.close() }
    } else {
        imageProxy.close()
    }
}
