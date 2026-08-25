package ac.undip.sso.core.scan

import ac.undip.sso.nowMs
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.coroutineContext

/**
 * Hasil pemindaian QR di wasmJs.
 */
sealed interface QrScanResult {
    /** Token QR berhasil terbaca. */
    data class Success(val token: String) : QrScanResult

    /** Gagal dengan pesan siap-tampil ke user (sudah humanized). */
    data class Error(val message: String) : QrScanResult
}

/** Jeda antar percobaan decode (ms) - sekitar 8 fps cukup untuk QR statis. */
private const val DECODE_INTERVAL_MS = 120L

/** Batas waktu menunggu QR terbaca sebelum berhenti sendiri (ms). */
private const val SCAN_TIMEOUT_MS = 15_000L

/**
 * Scanner QR untuk wasmJs: getUserMedia (kamera belakang) + jsQR.
 *
 * Arsitektur interop - SEMUA manipulasi DOM tinggal di sisi JS lewat opaque
 * [JsAny] handles supaya tidak mencampur tipe lama org.w3c dengan interop
 * baru Kotlin/Wasm (piksel frame juga tidak pernah disalin ke Kotlin):
 *  1. [jsImportJsQr]: dynamic import('jsqr') - literal string sehingga
 *     webpack bisa menganalisis dan mem-bundle modul npm-nya.
 *  2. [jsStartCamera]: buat <video> tersembunyi + canvas kerja, mulai
 *     stream; hasil dikirim balik lewat callback sebagai handles.
 *  3. Loop Kotlin mem-poll [jsDecodeFrame] tiap [DECODE_INTERVAL_MS].
 *  4. [jsStopCamera] di finally - tetap jalan saat coroutine dibatalkan
 *     navigasi tab, jadi lampu kamera tidak menyala sendirian.
 *
 * Pesan error kamera mengikuti pelajaran F0 di web (QrScanner.vue):
 * insecure context / izin ditolak / kamera tidak ada dipisah agar user tahu
 * apa yang harus dilakukan, dan input manual selalu jadi jalan keluar.
 */
object QrScanner {

    /**
     * Mulai kamera dan tunggu QR pertama terbaca.
     * Berhenti sendiri dalam [SCAN_TIMEOUT_MS]; aman dibatalkan dari luar.
     */
    suspend fun scanOnce(): QrScanResult {
        val startedAt = nowMs()

        // Decoder jsQR - dynamic import di-cache browser, murah dipanggil ulang.
        val decoder = try {
            awaitJs(jsImportJsQr())
        } catch (e: Throwable) {
            return QrScanResult.Error("Gagal menyiapkan pembaca QR: ${e.message}")
        }

        val camera = try {
            startCamera()
        } catch (e: Throwable) {
            return QrScanResult.Error(e.message ?: "Kamera tidak tersedia.")
        }

        try {
            while (coroutineContext.isActive) {
                if (nowMs() - startedAt > SCAN_TIMEOUT_MS) {
                    return QrScanResult.Error(
                        "Waktu tunggu habis. Arahkan QR ke kamera lalu coba lagi."
                    )
                }
                val text = jsDecodeFrame(decoder, camera.canvas, camera.video)?.toString()
                if (!text.isNullOrBlank()) {
                    return QrScanResult.Success(text.trim())
                }
                delay(DECODE_INTERVAL_MS)
            }
            // Dibatalkan dari luar - keluar tanpa menyalahkan user.
            return QrScanResult.Error("Pemindaian dihentikan.")
        } finally {
            jsStopCamera(camera.video)
        }
    }

    private class CameraHandles(val video: JsAny?, val canvas: JsAny?)

    private suspend fun awaitJs(promise: JsAny?): JsAny? =
        suspendCancellableCoroutine { cont ->
            jsBindPromise(
                promise,
                onResolved = { value -> cont.resume(value, onCancellation = null) },
                onRejected = { err ->
                    cont.resumeWith(Result.failure(Exception(jsErrText(err)?.toString())))
                },
            )
        }

    private suspend fun startCamera(): CameraHandles =
        suspendCancellableCoroutine { cont ->
            jsStartCamera(
                onReady = { video, canvas ->
                    cont.resume(CameraHandles(video, canvas), onCancellation = null)
                },
                onError = { message ->
                    cont.resumeWith(Result.failure(RuntimeException(message.toString())))
                },
            )
        }
}

// ---------- interop primitives (implementasi JS) ----------

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => import('jsqr').then(function(m){ return m.default || m; })")
private external fun jsImportJsQr(): JsAny?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(p, onOk, onFail) => p.then(onOk, onFail)")
private external fun jsBindPromise(
    promise: JsAny?,
    onResolved: (JsAny?) -> Unit,
    onRejected: (JsAny?) -> Unit,
)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(e) => { if (!e) return 'unknown error'; if (e.message) return e.message; return String(e); }")
private external fun jsErrText(err: JsAny?): JsString?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(onReady, onError) => {" +
        "try {" +
        "if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Kamera butuh koneksi aman (HTTPS atau localhost). Gunakan input manual, atau buka app lewat alamat aman.'); return; }" +
        "var v = document.createElement('video');" +
        "v.setAttribute('playsinline','');" +
        "v.setAttribute('muted','');" +
        "v.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0.01;';" +
        "document.body.appendChild(v);" +
        "var c = document.createElement('canvas');" +
        "navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function(stream) {" +
        "v.srcObject = stream;" +
        "var play = v.play(); if (play && play.catch) play.catch(function(){});" +
        "onReady(v, c);" +
        "}, function(e) {" +
        "v.remove(); c.remove();" +
        "var name = (e && e.name) ? e.name : 'Error';" +
        "if (name === 'NotAllowedError' || name === 'SecurityError') onError('Izin kamera ditolak. Izinkan akses kamera di browser lalu coba lagi, atau gunakan input manual.');" +
        "else if (name === 'NotFoundError' || name === 'OverconstrainedError') onError('Kamera tidak ditemukan pada perangkat ini. Gunakan input manual.');" +
        "else if (name === 'NotReadableError') onError('Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.');" +
        "else onError('Kamera gagal dimulai (' + name + '). Gunakan input manual.');" +
        "});" +
        "} catch (err) {" +
        "onError('Kamera gagal dimulai: ' + (err && err.message ? err.message : err));" +
        "}" +
        "}",
)
private external fun jsStartCamera(
    onReady: (video: JsAny?, canvas: JsAny?) -> Unit,
    onError: (message: JsAny?) -> Unit,
)

/**
 * Satu percobaan decode: sync ukuran canvas dengan video, draw frame, ambil
 * ImageData, jalankan jsQR. Mengembalikan teks QR atau null (belum ada QR /
 * frame belum siap). Semua di sisi JS - data piksel tidak pernah ke Kotlin.
 */
@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(decodeFn, c, v) => {" +
        "if (!v || !v.videoWidth || v.readyState < 2) return null;" +
        "if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }" +
        "var ctx = c.getContext('2d', { willReadFrequently: true });" +
        "ctx.drawImage(v, 0, 0, c.width, c.height);" +
        "try { var d = ctx.getImageData(0, 0, c.width, c.height); } catch (e) { return null; }" +
        "var r = decodeFn(d.data, d.width, d.height);" +
        "return r ? r.data : null;" +
        "}",
)
private external fun jsDecodeFrame(decodeFn: JsAny?, canvas: JsAny?, video: JsAny?): JsString?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(v) => {" +
        "if (!v || !v.srcObject) return;" +
        "var s = v.srcObject;" +
        "if (s.getTracks) s.getTracks().forEach(function(t){ t.stop(); });" +
        "v.srcObject = null;" +
        "if (v.parentNode) v.parentNode.removeChild(v);" +
        "}",
)
private external fun jsStopCamera(v: JsAny?)
