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
 *  2. [jsStartCamera]: tampilkan overlay kamera fullscreen (video terlihat,
 *     kotak frame, tombol tutup) + canvas kerja OFFSCREEN utk decode;
 *     hasil dikirim balik lewat callback sebagai handles.
 *  3. Loop Kotlin mem-poll [jsDecodeFrame] tiap [DECODE_INTERVAL_MS];
 *     tombol tutup hanya menandai [closeRequested] - loop yang keluar
 *     sehingga cleanup lewat finally tetap satu jalur.
 *  4. [jsStopCamera] di finally - tetap jalan saat coroutine dibatalkan
 *     navigasi tab, jadi lampu kamera tidak menyala sendirian.
 *
 * Pesan error kamera mengikuti pelajaran F0 di web (QrScanner.vue):
 * insecure context / izin ditolak / kamera tidak ada dipisah agar user tahu
 * apa yang harus dilakukan, dan input manual selalu jadi jalan keluar.
 */
object QrScanner {

    /**
     * Ditandai tombol tutup overlay. Single-threaded wasm (event loop) ->
     * plain var aman; dibaca tiap tick loop decode.
     */
    private var closeRequested = false

    /**
     * Mulai kamera dan tunggu QR pertama terbaca.
     * Berhenti sendiri dalam [SCAN_TIMEOUT_MS]; aman dibatalkan dari luar.
     */
    suspend fun scanOnce(): QrScanResult {
        val startedAt = nowMs()
        closeRequested = false

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
                if (closeRequested) {
                    return QrScanResult.Error("Pemindaian dihentikan.")
                }
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
            jsStopCamera(camera.wrap)
        }
    }

    private class CameraHandles(val video: JsAny?, val wrap: JsAny?, val canvas: JsAny?)

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
                onReady = { video, wrap, canvas ->
                    cont.resume(CameraHandles(video, wrap, canvas), onCancellation = null)
                },
                onError = { message ->
                    cont.resumeWith(Result.failure(RuntimeException(message.toString())))
                },
                // Tombol tutup overlay TIDAK me-resume await ini (hindari
                // resume-ganda) - cukup menandai closeRequested; loop decode
                // yang keluar dan cleanup jalan lewat finally.
                onCancel = { closeRequested = true },
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
    "(onReady, onError, onCancel) => {" +
        "try {" +
        "if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Kamera butuh koneksi aman (HTTPS atau localhost). Gunakan input manual, atau buka app lewat alamat aman.'); return; }" +
        "var wrap = document.createElement('div');" +
        "wrap.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;';" +
        "var v = document.createElement('video');" +
        "v.setAttribute('playsinline','');" +
        "v.setAttribute('muted','');" +
        "v.autoplay = true;" +
        "v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;';" +
        "var frame = document.createElement('div');" +
        "frame.style.cssText = 'position:relative;width:min(72vw,280px);height:min(72vw,280px);border:3px solid rgba(255,255,255,0.85);border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,0.35);';" +
        "var hint = document.createElement('p');" +
        "hint.textContent = 'Arahkan QR ke dalam kotak';" +
        "hint.style.cssText = 'position:absolute;left:0;right:0;bottom:48px;margin:0;text-align:center;color:rgba(255,255,255,0.85);font-family:sans-serif;font-size:14px;';" +
        "var btn = document.createElement('button');" +
        "btn.type = 'button';" +
        "btn.setAttribute('aria-label','Tutup scanner');" +
        "btn.textContent = '\\u2715';" +
        "btn.style.cssText = 'position:absolute;top:16px;right:16px;width:44px;height:44px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:18px;line-height:1;cursor:pointer;';" +
        "wrap.appendChild(v); wrap.appendChild(frame); wrap.appendChild(hint); wrap.appendChild(btn);" +
        "document.body.appendChild(wrap);" +
        "btn.addEventListener('click', function(){ onCancel(); });" +
        "navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function(stream) {" +
        "v.srcObject = stream;" +
        "var play = v.play(); if (play && play.catch) play.catch(function(){});" +
        "var c = document.createElement('canvas');" +
        "onReady(v, wrap, c);" +
        "}, function(e) {" +
        "wrap.remove();" +
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
    onReady: (video: JsAny?, wrap: JsAny?, canvas: JsAny?) -> Unit,
    onError: (message: JsAny?) -> Unit,
    onCancel: () -> Unit,
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
    "(wrap) => {" +
        "if (!wrap) return;" +
        "var v = wrap.querySelector ? wrap.querySelector('video') : null;" +
        "if (v && v.srcObject && v.srcObject.getTracks) v.srcObject.getTracks().forEach(function(t){ t.stop(); });" +
        "if (wrap.parentNode) wrap.parentNode.removeChild(wrap);" +
        "}",
)
private external fun jsStopCamera(wrap: JsAny?)
