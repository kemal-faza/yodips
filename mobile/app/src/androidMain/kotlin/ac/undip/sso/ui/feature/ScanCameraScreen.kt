package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * QR presence scanner — Android actual. Live CameraX preview; each frame is
 * pushed through the MLKit QR decoder. On the first QR token found the analysis
 * is paused and the token is POSTed to `POST /api/siap/kehadiran` (proxied to
 * SIAP). The scan frame + corner overlay guide alignment; a result card shows
 * the outcome with a "Scan lagi" reset.
 *
 * Extras: pinch + on-screen buttons for zoom, a flip switch between the front
 * and back cameras. The scan frame pulses with a subtle scale up/down loop.
 */
@Composable
internal actual fun ScanScreen(repo: SsoRepository) {
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

    // Lens + zoom live for the whole screen lifetime.
    var useFrontCamera by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var zoomRatio by remember { mutableStateOf(1f) }
    var maxZoom by remember { mutableStateOf(1f) }

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

    // Bind/unbind the camera use cases. Re-binds whenever permission or the
    // chosen lens flips. Kept bound even while a result popup shows, so the
    // back camera keeps running behind the dialog.
    DisposableEffect(permissionGranted, useFrontCamera) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val bind =
            Runnable {
                val provider = providerFuture.get()
                if (!permissionGranted) return@Runnable
                val selector = cameraSelectorFor(provider, useFrontCamera)
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
                val boundCamera = provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
                camera = boundCamera
                maxZoom = boundCamera.cameraInfo.zoomState.value
                    ?.maxZoomRatio ?: 1f
            }
        providerFuture.addListener(bind, ContextCompat.getMainExecutor(context))
        onDispose {
            providerFuture.addListener(
                { if (providerFuture.isDone) providerFuture.get().unbindAll() },
                ContextCompat.getMainExecutor(context),
            )
        }
    }

    // Push the selected zoom onto the live camera whenever it (or the camera) changes.
    LaunchedEffect(camera, zoomRatio) {
        val cam = camera ?: return@LaunchedEffect
        if (zoomRatio != 1f) cam.cameraControl.setZoomRatio(zoomRatio)
    }

    fun adjustZoom(delta: Float) {
        zoomRatio = (zoomRatio * delta).coerceIn(1f, maxZoom.coerceAtLeast(1f))
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
                            .background(Color.Black)
                            .pointerInput(Unit) {
                                // Pinch to zoom over the live preview.
                                detectTransformGestures { _, _, zoom, _ ->
                                    val target = (zoomRatio * zoom).coerceIn(1f, maxZoom.coerceAtLeast(1f))
                                    zoomRatio = target
                                }
                            },
                    ) {
                        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
                        ScanOverlay()
                        ScanControls(
                            useFrontCamera = useFrontCamera,
                            zoomRatio = zoomRatio,
                            onFlipCamera = {
                                useFrontCamera = !useFrontCamera
                                zoomRatio = 1f
                            },
                            onZoomIn = { adjustZoom(1.25f) },
                            onZoomOut = { adjustZoom(0.8f) },
                            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
                        )
                    }
                }
                // Centered result popup over the still-running camera.
                outcome?.let { o ->
                    ScanResultDialog(
                        outcome = o,
                        onReset = {
                            outcome = null
                            processing.set(false)
                        },
                    )
                }
            }
        }
    }
}

/** Pick the front camera when requested and present, else fall back to the back one. */
private fun cameraSelectorFor(
    provider: ProcessCameraProvider,
    front: Boolean,
): CameraSelector {
    if (!front) return CameraSelector.DEFAULT_BACK_CAMERA
    val frontAvailable = runCatching { provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) }.getOrDefault(false)
    return if (frontAvailable) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
}

/** Guide frame drawn over the live preview, pulsing with a subtle scale up/down. */
@Composable
private fun ScanOverlay() {
    val transition = rememberInfiniteTransition(label = "scanFrame")
    val scale by
        transition.animateFloat(
            initialValue = 0.96f,
            targetValue = 1.04f,
            animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
            label = "frameScale",
        )
    Box(
        Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(260.dp)
                .scale(scale)
                .border(3.dp, ac.undip.sso.ui.theme.Primary, RoundedCornerShape(16.dp)),
        )
    }
}

/** Overlay buttons (flip camera + zoom in/out + level) pinned to the preview. */
@Composable
private fun ScanControls(
    useFrontCamera: Boolean,
    zoomRatio: Float,
    onFlipCamera: () -> Unit,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.45f)) {
            IconButton(onClick = onFlipCamera) {
                Icon(
                    Icons.Filled.Cameraswitch,
                    contentDescription = "Ganti kamera (depan/belakang)",
                    tint = Color.White,
                )
            }
        }
        Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.45f)) {
            IconButton(onClick = onZoomIn) {
                Icon(Icons.Filled.ZoomIn, contentDescription = "Perbesar", tint = Color.White)
            }
        }
        Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.45f)) {
            IconButton(onClick = onZoomOut) {
                Icon(Icons.Filled.ZoomOut, contentDescription = "Perkecil", tint = Color.White)
            }
        }
        Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.45f)) {
            Text(
                "%.1fx".format(zoomRatio),
                style = MaterialTheme.typography.labelMedium,
                color = Color.White,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
        if (useFrontCamera) {
            Text("Depan", style = MaterialTheme.typography.labelSmall, color = Color.White)
        }
    }
}

/** Centered result popup shown over the still-running camera. */
@Composable
private fun ScanResultDialog(
    outcome: ScanOutcome,
    onReset: () -> Unit,
) {
    val bg = if (outcome.success) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer
    val fg = if (outcome.success) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer
    AlertDialog(
        onDismissRequest = { /* hold until Scan lagi / explicit action */ },
        icon = {
            Icon(
                if (outcome.success) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline,
                contentDescription = null,
                tint = fg,
                modifier = Modifier.size(48.dp),
            )
        },
        title = {
            Text(
                if (outcome.success) "Berhasil" else "Gagal",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        text = {
            Text(
                outcome.message,
                style = MaterialTheme.typography.bodyMedium,
                color = fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            Button(onClick = onReset, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text("Scan lagi")
            }
        },
        containerColor = bg,
    )
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
            tint = ac.undip.sso.ui.theme.accentForeground(),
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
