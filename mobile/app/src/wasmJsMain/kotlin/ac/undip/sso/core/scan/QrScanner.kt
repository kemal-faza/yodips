package ac.undip.sso.core.scan

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

    /** User menutup scanner sendiri / coroutine dibatalkan - bukan error, tanpa pesan. */
    data object Cancelled : QrScanResult
}

/**
 * Bounding box (in CSS px) that the camera overlay should occupy — i.e. the
 * Compose content area between the top bar and the bottom nav. `null` in
 * [QrScanner.scanOnce] keeps the legacy fullscreen behavior (used by
 * LoginScreen pairing scan).
 */
data class CameraRegion(
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
)

/** Jeda antar percobaan decode (ms) - sekitar 8 fps cukup untuk QR statis. */
private const val DECODE_INTERVAL_MS = 120L

/**
 * Scanner QR untuk wasmJs: getUserMedia (kamera belakang) + jsQR.
 *
 * Arsitektur interop - SEMUA manipulasi DOM tinggal di sisi JS lewat opaque
 * [JsAny] handles supaya tidak mencampur tipe lama org.w3c dengan interop
 * baru Kotlin/Wasm (piksel frame juga tidak pernah disalin ke Kotlin):
 *  1. [jsImportJsQr]: dynamic import('jsqr') - literal string sehingga
 *     webpack bisa menganalisis dan mem-bundle modul npm-nya.
 *  2. [jsStartCamera]: tampilkan overlay kamera (video terlihat + kotak frame
 *     teal ber-pulse + hint + kontrol flip/zoom/level; BUKAN tombol tutup —
 *     paritas Android; keluar dari layar scan via navigasi). Ketika region
 *     diberikan, overlay di-`position:fixed` tepat di area konten (antara top
 *     bar & bottom nav); tanpa region, fallback ke fullscreen (perilaku lama).
 *     Ditambah canvas kerja OFFSCREEN utk decode; hasil dikirim balik lewat
 *     callback sebagai handles.
 *  3. Loop Kotlin mem-poll [jsDecodeFrame] tiap [DECODE_INTERVAL_MS];
 *     pembatalan coroutine (navigasi keluar) menandai [closeRequested] -
 *     loop yang keluar sehingga cleanup lewat finally tetap satu jalur.
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
     * Mulai kamera dan tunggu QR pertama terbaca. Scan berjalan sampai kode
     * ketemu atau user menutup lewat tombol tutup; aman dibatalkan dari luar.
     */
    suspend fun scanOnce(region: CameraRegion? = null): QrScanResult {
        closeRequested = false

        // Decoder jsQR - dynamic import di-cache browser, murah dipanggil ulang.
        val decoder = try {
            awaitJs(jsImportJsQr())
        } catch (e: Throwable) {
            return QrScanResult.Error("Gagal menyiapkan pembaca QR: ${e.message}")
        }

        val camera = try {
            startCamera(region)
        } catch (e: Throwable) {
            return QrScanResult.Error(e.message ?: "Kamera tidak tersedia.")
        }

        try {
            while (coroutineContext.isActive) {
                if (closeRequested) {
                    return QrScanResult.Cancelled
                }
                val text = jsDecodeFrame(decoder, camera.canvas, camera.video)?.toString()
                if (!text.isNullOrBlank()) {
                    return QrScanResult.Success(text.trim())
                }
                delay(DECODE_INTERVAL_MS)
            }
            // Dibatalkan dari luar - bukan error, tanpa pesan.
            return QrScanResult.Cancelled
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

    private suspend fun startCamera(region: CameraRegion?): CameraHandles =
        suspendCancellableCoroutine { cont ->
            jsStartCamera(
                region?.left, region?.top, region?.width, region?.height,
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
    "(l, t, w, h, onReady, onError, onCancel) => {" +
        "try {" +
        "if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Kamera butuh koneksi aman (HTTPS atau localhost). Gunakan input manual, atau buka app lewat alamat aman.'); return; }" +
        "var hasRegion = (l != null && t != null && w != null && h != null && w > 0 && h > 0);" +
        "var wrap = document.createElement('div');" +
        "wrap.style.cssText = hasRegion" +
        "  ? 'position:fixed;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;z-index:2147483647;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;'" +
        "  : 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;';" +
        "var st = document.createElement('style');" +
        "st.setAttribute('data-yd-scan','1');" +
        "st.textContent = '.yd-scanframe{position:relative;border:3px solid #01637E;border-radius:16px;animation:ydpulse 0.9s ease-in-out infinite alternate;}'" +
        "  + '@keyframes ydpulse{from{transform:scale(0.96);}to{transform:scale(1.04);}}'" +
        "  + '.yd-hint{position:absolute;left:0;right:0;bottom:48px;margin:0;text-align:center;color:rgba(255,255,255,0.85);font-family:sans-serif;font-size:14px;}'" +
        "  + '.yd-ctrl{position:absolute;top:12px;right:12px;display:flex;flex-direction:column;gap:8px;align-items:center;}'" +
        "  + '.yd-btn{width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,0.45);border:none;color:#fff;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}'" +
        "  + '.yd-lvl{background:rgba(0,0,0,0.45);border-radius:16px;color:#fff;font-family:sans-serif;font-size:13px;padding:6px 10px;}'" +
        "  + '.yd-front{color:#fff;font-family:sans-serif;font-size:12px;}';" +
        "document.head.appendChild(st);" +
        "var v = document.createElement('video');" +
        "v.setAttribute('playsinline','');" +
        "v.setAttribute('muted','');" +
        "v.autoplay = true;" +
        "v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:center;transition:transform 0.15s ease-out;';" +
        "var frame = document.createElement('div');" +
        "frame.className = 'yd-scanframe';" +
        "var hint = document.createElement('p');" +
        "hint.textContent = 'Arahkan QR ke dalam kotak';" +
        "hint.className = 'yd-hint';" +
        "var ctrl = document.createElement('div');" +
        "ctrl.className = 'yd-ctrl';" +
        "var zoomRatio = 1.0; var maxZoom = 3.0;" +
        "var front = false;" +
        "var flipBtn = document.createElement('button'); flipBtn.className='yd-btn'; flipBtn.innerHTML='<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\"><path d=\"M9 4l-5 3v12l5-3zM15 20l5-3V5l-5 3z\"/><path d=\"M4 7h9M20 17h-9\"/></svg>'; flipBtn.title='Ganti kamera';" +
        "var zoomInBtn = document.createElement('button'); zoomInBtn.className='yd-btn'; zoomInBtn.textContent='+'; zoomInBtn.title='Perbesar';" +
        "var zoomOutBtn = document.createElement('button'); zoomOutBtn.className='yd-btn'; zoomOutBtn.textContent='−'; zoomOutBtn.title='Perkecil';" +
        "var lvl = document.createElement('div'); lvl.className='yd-lvl'; lvl.textContent='1.0x';" +
        "var frontLbl = document.createElement('div'); frontLbl.className='yd-front'; frontLbl.textContent='Depan'; frontLbl.style.display='none';" +
        "ctrl.appendChild(flipBtn); ctrl.appendChild(zoomInBtn); ctrl.appendChild(zoomOutBtn); ctrl.appendChild(lvl); ctrl.appendChild(frontLbl);" +
        "var applyZoom = function(){ v.style.transform = 'scale(' + zoomRatio + ')'; lvl.textContent = (Math.round(zoomRatio*10)/10) + 'x'; };" +
        "zoomInBtn.onclick = function(){ zoomRatio = Math.min(zoomRatio * 1.25, maxZoom); applyZoom(); };" +
        "zoomOutBtn.onclick = function(){ zoomRatio = Math.max(zoomRatio * 0.8, 1.0); applyZoom(); };" +
        "wrap.appendChild(v); wrap.appendChild(frame); wrap.appendChild(hint); wrap.appendChild(ctrl);" +
        "document.body.appendChild(wrap);" +
        "var frameSize = Math.min(Math.min(wrap.clientWidth, wrap.clientHeight) * 0.7, 280);" +
        "if (frameSize > 0) { frame.style.width = frameSize + 'px'; frame.style.height = frameSize + 'px'; } else { frame.style.width = 'min(72vw,280px)'; frame.style.height = 'min(72vw,280px)'; }" +
        "var startStream = function(mode){ return navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false }); };" +
        "var openStream = function(stream){ v.srcObject = stream; var play = v.play(); if (play && play.catch) play.catch(function(){}); };" +
        "flipBtn.onclick = function(){ front = !front; frontLbl.style.display = front ? 'block' : 'none'; startStream(front ? 'user' : 'environment').then(function(s){ if (v.srcObject && v.srcObject.getTracks) v.srcObject.getTracks().forEach(function(t){ t.stop(); }); openStream(s); }).catch(function(e){ /* keep current stream on flip failure */ }); };" +
        "startStream(front ? 'user' : 'environment').then(function(stream){" +
        "openStream(stream);" +
        "var c = document.createElement('canvas');" +
        "onReady(v, wrap, c);" +
        "}, function(e) {" +
        "wrap.remove(); st.remove();" +
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
    l: Int?,
    t: Int?,
    w: Int?,
    h: Int?,
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
        "var css = document.querySelector('style[data-yd-scan]');" +
        "if (css) css.remove();" +
        "}",
)
private external fun jsStopCamera(wrap: JsAny?)
