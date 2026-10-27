package ac.undip.sso.ui.feature

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

/**
 * Decode a QR token from a gallery image picked by the user. Tries the image at
 * its own size first (unchanged behaviour), then at a ladder of smaller long
 * edges — see [galleryRetryLongEdges] for why. Runs in an IO context: decoding
 * is CPU+IO and must not touch the main thread.
 */
internal suspend fun decodeQrFromGallery(
    context: Context,
    scanner: BarcodeScanner,
    uri: Uri,
): GalleryDecode =
    withContext(Dispatchers.IO) {
        var sourceLongEdge: Int? = null
        var imageReadable = false

        loadGalleryBitmap(context, uri, targetLongEdge = null)?.let { bitmap ->
            sourceLongEdge = maxOf(bitmap.width, bitmap.height)
            imageReadable = true
            try {
                decodeQrToken(scanner, bitmap)?.let { return@withContext GalleryDecode.Qr(it) }
            } finally {
                bitmap.recycle()
            }
        }

        for (longEdge in galleryRetryLongEdges(sourceLongEdge)) {
            val bitmap = loadGalleryBitmap(context, uri, targetLongEdge = longEdge) ?: continue
            imageReadable = true
            try {
                decodeQrToken(scanner, bitmap)?.let { return@withContext GalleryDecode.Qr(it) }
            } finally {
                bitmap.recycle()
            }
        }

        if (imageReadable) GalleryDecode.NoQr else GalleryDecode.ImageUnreadable
    }

/**
 * Decode the file once, at [targetLongEdge] when given. Decoding with a target
 * size keeps the allocated bitmap bounded instead of materialising the full
 * camera photo.
 */
private fun loadGalleryBitmap(
    context: Context,
    uri: Uri,
    targetLongEdge: Int?,
): Bitmap? =
    runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ImageDecoder.decodeBitmap(
                ImageDecoder.createSource(context.contentResolver, uri),
            ) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.isMutableRequired = false
                if (targetLongEdge != null) {
                    val longEdge = maxOf(info.size.width, info.size.height)
                    if (longEdge > targetLongEdge) {
                        val scale = targetLongEdge.toFloat() / longEdge
                        decoder.setTargetSize(
                            (info.size.width * scale).toInt().coerceAtLeast(1),
                            (info.size.height * scale).toInt().coerceAtLeast(1),
                        )
                    }
                }
            }
        } else {
            @Suppress("DEPRECATION")
            val full = android.provider.MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
            if (targetLongEdge == null) {
                full
            } else {
                val longEdge = maxOf(full.width, full.height)
                if (longEdge <= targetLongEdge) {
                    full
                } else {
                    val scale = targetLongEdge.toFloat() / longEdge
                    Bitmap
                        .createScaledBitmap(
                            full,
                            (full.width * scale).toInt().coerceAtLeast(1),
                            (full.height * scale).toInt().coerceAtLeast(1),
                            true,
                        ).also { if (it !== full) full.recycle() }
                }
            }
        }
    }.onFailure {
        // Stage only: the raw error text (and any payload) stays out of the log.
        Log.w("ScanGallery", "decode failed at target=${targetLongEdge ?: "source"}: ${it.javaClass.simpleName}")
    }.getOrNull()

/** First QR token in [bitmap], or null when the detector found none. */
private suspend fun decodeQrToken(scanner: BarcodeScanner, bitmap: Bitmap): String? =
    runCatching {
        scanner
            .process(InputImage.fromBitmap(bitmap, 0))
            .await()
            .firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
            ?.rawValue
            ?.takeIf { it.isNotBlank() }
    }.onFailure {
        Log.w("ScanGallery", "detector failed: ${it.javaClass.simpleName}")
    }.getOrNull()

/** Await a google-play-services [Task] from a coroutine. */
private suspend fun <T> Task<T>.await(): T =
    suspendCancellableCoroutine { cont ->
        addOnSuccessListener { cont.resume(it) }
        addOnFailureListener { e -> cont.resumeWith(Result.failure(e)) }
        addOnCanceledListener { cont.cancel() }
    }
