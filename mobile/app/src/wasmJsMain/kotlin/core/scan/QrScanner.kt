@file:OptIn(ExperimentalWasmJsInterop::class)

package ac.undip.sso.core.scan

import ac.undip.sso.core.network.UserMessages
import kotlinx.coroutines.CancellationException
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
 * [QrScanner.scanOnce] keeps the legacy fullscreen behavior; no caller uses it
 * today — login and attendance always pass a region.
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
        // Retry sekali-dua kali: import chunk bisa gagal transien saat service
        // worker / cache PWA baru selesai install, dan dulu itu memunculkan
        // "Kamera tidak dapat disiapkan" pada tap pertama.
        val decoder = try {
            loadDecoder()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            return QrScanResult.Error(UserMessages.SCANNER_SETUP)
        }

        val camera = try {
            startCamera(region)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // startCamera's JS layer throws already-humanized copy per error
            // class; the catalog only covers a blank/unexpected throw.
            return QrScanResult.Error(e.message?.takeIf { it.isNotBlank() } ?: UserMessages.SCANNER_UNAVAILABLE)
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

    /**
     * Buka file picker gambar, decode QR dari foto terpilih dengan jsQR.
     * Dipakai tombol "Pilih dari Galeri" (PWA). Tidak menyentuh kamera.
     */
    suspend fun scanFromFile(): QrScanResult {
        val decoder = try {
            loadDecoder()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            return QrScanResult.Error(UserMessages.SCANNER_SETUP)
        }
        return try {
            val text = awaitJs(jsDecodeFile(decoder))?.toString()
            if (text.isNullOrBlank()) {
                QrScanResult.Error(UserMessages.QR_NOT_FOUND)
            } else {
                QrScanResult.Success(text.trim())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            QrScanResult.Error(UserMessages.PHOTO_UNREADABLE)
        }
    }

    /** Import jsQR dengan retry singkat untuk kegagalan chunk transien. */
    private suspend fun loadDecoder(): JsAny? {
        var last: Throwable? = null
        repeat(3) { attempt ->
            try {
                return awaitJs(jsImportJsQr())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                last = e
                if (attempt < 2) delay(150)
            }
        }
        throw last ?: IllegalStateException("jsQR tidak tersedia")
    }

    private suspend fun awaitJs(promise: JsAny?): JsAny? =
        suspendCancellableCoroutine { cont ->
            jsBindPromise(
                promise,
                // A cancelled continuation must never be resumed: navigating
                // away while the chunk/camera promise is in flight used to
                // surface as a spurious scanner error.
                onResolved = { value ->
                    if (cont.isActive) cont.resume(value, onCancellation = null)
                },
                onRejected = { err ->
                    if (cont.isActive) {
                        cont.resumeWith(Result.failure(Exception(jsErrText(err)?.toString())))
                    }
                },
            )
        }

    private suspend fun startCamera(region: CameraRegion?): CameraHandles =
        suspendCancellableCoroutine { cont ->
            // Kalau layar ditinggalkan saat getUserMedia masih menunggu izin,
            // continuation ini dibatalkan sebelum wrap dikembalikan ke Kotlin.
            // Tanpa cleanup di sini overlay + lampu kamera akan tertinggal.
            cont.invokeOnCancellation { jsStopCamera(null) }
            jsStartCamera(
                region?.left, region?.top, region?.width, region?.height,
                onReady = { video, wrap, canvas ->
                    if (cont.isActive) {
                        cont.resume(CameraHandles(video, wrap, canvas), onCancellation = null)
                    }
                },
                onError = { message ->
                    if (cont.isActive) {
                        cont.resumeWith(Result.failure(RuntimeException(message.toString())))
                    }
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
        // Satu overlay saja. Overlay lama bisa tertinggal kalau coroutine scan
        // dibatalkan tepat saat getUserMedia masih menunggu izin; bersihkan
        // sebelum membuat yang baru supaya dashboard tidak tertutup kamera.
        "var olds = document.querySelectorAll('[data-yd-scan-wrap]');" +
        "for (var oi = 0; oi < olds.length; oi++) { if (olds[oi].__ydStop) olds[oi].__ydStop(); }" +
        "if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError('Kamera butuh koneksi aman (HTTPS atau localhost). Gunakan input manual, atau buka app lewat alamat aman.'); return; }" +
        "var hasRegion = (l != null && t != null && w != null && h != null && w > 0 && h > 0);" +
        "var wrap = document.createElement('div');" +
        "wrap.setAttribute('data-yd-scan-wrap','1');" +
        "wrap.style.cssText = hasRegion" +
        "  ? 'position:fixed;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;z-index:2147483647;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;touch-action:none;overflow:hidden;'" +
        "  : 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;touch-action:none;overflow:hidden;';" +
        "var st = document.createElement('style');" +
        "st.setAttribute('data-yd-scan','1');" +
        "st.textContent = '.yd-scanframe{position:relative;border:3px solid #01637E;border-radius:16px;animation:ydpulse 0.9s ease-in-out infinite alternate;pointer-events:none;}'" +
        "  + '@keyframes ydpulse{from{transform:scale(0.96);}to{transform:scale(1.04);}}'" +
        "  + '.yd-hint{position:absolute;left:0;right:0;bottom:48px;margin:0;text-align:center;color:rgba(255,255,255,0.85);font-family:sans-serif;font-size:14px;pointer-events:none;}'" +
        "  + '.yd-ctrl{position:absolute;top:12px;right:12px;display:flex;flex-direction:column;gap:8px;align-items:center;z-index:2;}'" +
        "  + '.yd-btn{width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,0.45);border:none;color:#fff;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}'" +
        "  + '.yd-btn:disabled{opacity:.45;cursor:default;}'" +
        "  + '.yd-lvl{background:rgba(0,0,0,0.45);border-radius:16px;color:#fff;font-family:sans-serif;font-size:13px;padding:6px 10px;}'" +
        "  + '.yd-front{color:#fff;font-family:sans-serif;font-size:12px;}'" +
        "  + '.yd-focus{position:absolute;width:56px;height:56px;border:2px solid #7fd4e6;border-radius:50%;transform:translate(-50%,-50%) scale(0.6);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:3;}'" +
        "  + '.yd-focus.show{opacity:1;transform:translate(-50%,-50%) scale(1);}';" +
        "document.head.appendChild(st);" +
        "var v = document.createElement('video');" +
        "v.setAttribute('playsinline','');" +
        "v.setAttribute('muted','');" +
        "v.autoplay = true;" +
        "v.muted = true;" +
        "v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;transform-origin:center;transition:transform 0.15s ease-out;touch-action:none;';" +
        "var frame = document.createElement('div');" +
        "frame.className = 'yd-scanframe';" +
        "var hint = document.createElement('p');" +
        "hint.textContent = 'Arahkan QR ke dalam kotak';" +
        "hint.className = 'yd-hint';" +
        "var ctrl = document.createElement('div');" +
        "ctrl.className = 'yd-ctrl';" +
        "var zoomRatio = 1.0;" +
        "var maxZoom = 3.0;" +
        "var front = false;" +
        "var track = null;" +
        "var hasHwZoom = false;" +
        "var hwMin = 1;" +
        "var hwMax = 1;" +
        "var hwZoomFailed = false;" +
        "var focusRing = document.createElement('div');" +
        "focusRing.className = 'yd-focus';" +
        "var flipBtn = document.createElement('button'); flipBtn.className='yd-btn'; flipBtn.innerHTML='<svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"#fff\" aria-hidden=\"true\"><path d=\"M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z\"/></svg>'; flipBtn.title='Ganti kamera'; flipBtn.setAttribute('aria-label','Ganti kamera');" +
        "var zoomInBtn = document.createElement('button'); zoomInBtn.className='yd-btn'; zoomInBtn.textContent='+'; zoomInBtn.title='Perbesar';" +
        "var zoomOutBtn = document.createElement('button'); zoomOutBtn.className='yd-btn'; zoomOutBtn.textContent='−'; zoomOutBtn.title='Perkecil';" +
        "var lvl = document.createElement('div'); lvl.className='yd-lvl'; lvl.textContent='1.0x';" +
        "var frontLbl = document.createElement('div'); frontLbl.className='yd-front'; frontLbl.textContent='Depan'; frontLbl.style.display='none';" +
        "ctrl.appendChild(flipBtn); ctrl.appendChild(zoomInBtn); ctrl.appendChild(zoomOutBtn); ctrl.appendChild(lvl); ctrl.appendChild(frontLbl);" +
        "wrap.appendChild(v); wrap.appendChild(frame); wrap.appendChild(hint); wrap.appendChild(ctrl); wrap.appendChild(focusRing);" +
        "document.body.appendChild(wrap);" +
        "var stopWrap = function() {" +
        "  wrap.__ydCancelled = true;" +
        "  var vv = wrap.querySelector ? wrap.querySelector('video') : null;" +
        "  if (vv && vv.srcObject && vv.srcObject.getTracks) {" +
        "    vv.srcObject.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} });" +
        "  }" +
        "  if (wrap.parentNode) wrap.parentNode.removeChild(wrap);" +
        "  if (!document.querySelector('[data-yd-scan-wrap]')) {" +
        "    var css = document.querySelector('style[data-yd-scan]');" +
        "    if (css) css.remove();" +
        "  }" +
        "};" +
        "wrap.__ydStop = stopWrap;" +
        "var frameSize = Math.min(Math.min(wrap.clientWidth, wrap.clientHeight) * 0.7, 280);" +
        "if (frameSize > 0) { frame.style.width = frameSize + 'px'; frame.style.height = frameSize + 'px'; } else { frame.style.width = 'min(72vw,280px)'; frame.style.height = 'min(72vw,280px)'; }" +
        "var applyFocusMode = function(mode) {" +
        "  if (!track || !track.applyConstraints) return;" +
        "  try {" +
        "    var caps = track.getCapabilities ? track.getCapabilities() : {};" +
        "    var modes = caps.focusMode || [];" +
        "    if (modes.indexOf(mode) === -1) return;" +
        "    track.applyConstraints({ advanced: [{ focusMode: mode }] }).catch(function(){});" +
        "  } catch (e) {}" +
        "};" +
        "var applyHwZoom = function(ratio) {" +
        "  if (!hasHwZoom || hwZoomFailed || !track || !track.applyConstraints) return;" +
        "  var value = hwMin * ratio;" +
        "  value = Math.max(hwMin, Math.min(hwMax, value));" +
        "  track.applyConstraints({ advanced: [{ zoom: value }] }).catch(function() {" +
        "    hwZoomFailed = true;" +
        "    applyZoom();" +
        "  });" +
        "};" +
        "var applyZoom = function() {" +
        "  zoomRatio = Math.max(1, Math.min(zoomRatio, maxZoom));" +
        "  if (hasHwZoom && !hwZoomFailed) {" +
        "    v.dataset.hwZoom = '1';" +
        "    v.dataset.zoom = String(zoomRatio);" +
        "    v.style.transform = '';" +
        "    applyHwZoom(zoomRatio);" +
        "  } else {" +
        "    v.dataset.hwZoom = '0';" +
        "    v.dataset.zoom = String(zoomRatio);" +
        "    v.style.transform = 'scale(' + zoomRatio + ')';" +
        "  }" +
        "  lvl.textContent = (Math.round(zoomRatio * 10) / 10) + 'x';" +
        "};" +
        "var bindTrack = function(stream) {" +
        "  track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;" +
        "  try {" +
        "    var facing = (track && track.getSettings) ? (track.getSettings().facingMode || '') : '';" +
        "    if (facing === 'user') front = true;" +
        "    else if (facing === 'environment') front = false;" +
        "  } catch (e) {}" +
        "  frontLbl.style.display = front ? 'block' : 'none';" +
        "  hasHwZoom = false;" +
        "  hwMin = 1;" +
        "  hwMax = 1;" +
        "  hwZoomFailed = false;" +
        "  maxZoom = 3.0;" +
        "  if (track && track.getCapabilities) {" +
        "    try {" +
        "      var caps = track.getCapabilities();" +
        "      var z = caps.zoom;" +
        "      if (z && typeof z.max === 'number' && typeof z.min === 'number' && z.max > z.min) {" +
        "        hasHwZoom = true;" +
        "        hwMin = z.min;" +
        "        hwMax = z.max;" +
        "        maxZoom = Math.min(4, hwMax / hwMin);" +
        "      }" +
        "    } catch (e) { maxZoom = 3.0; }" +
        "  }" +
        "  applyFocusMode('continuous');" +
        "  applyZoom();" +
        "};" +
        "var focusAt = function(clientX, clientY) {" +
        "  if (!track || !track.applyConstraints) return;" +
        "  var rect = v.getBoundingClientRect();" +
        "  if (!rect.width || !rect.height) return;" +
        "  var x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));" +
        "  var y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));" +
        "  var vw = v.videoWidth || rect.width;" +
        "  var vh = v.videoHeight || rect.height;" +
        "  var videoAspect = vw / vh;" +
        "  var boxAspect = rect.width / rect.height;" +
        "  var nx = x;" +
        "  var ny = y;" +
        "  if (videoAspect > boxAspect) {" +
        "    var visibleW = boxAspect / videoAspect;" +
        "    nx = (1 - visibleW) / 2 + x * visibleW;" +
        "  } else if (videoAspect < boxAspect) {" +
        "    var visibleH = videoAspect / boxAspect;" +
        "    ny = (1 - visibleH) / 2 + y * visibleH;" +
        "  }" +
        "  var constraints = null;" +
        "  try {" +
        "    var caps = track.getCapabilities ? track.getCapabilities() : {};" +
        "    var modes = caps.focusMode || [];" +
        "    if (caps.pointsOfInterest) {" +
        "      constraints = { advanced: [{ pointsOfInterest: [{ x: nx, y: ny }], focusMode: 'single-shot' }] };" +
        "    } else if (modes.indexOf('single-shot') !== -1) {" +
        "      constraints = { advanced: [{ focusMode: 'single-shot' }] };" +
        "    } else if (modes.indexOf('continuous') !== -1) {" +
        "      constraints = { advanced: [{ focusMode: 'continuous' }] };" +
        "    }" +
        "  } catch (e) {}" +
        "  if (constraints) track.applyConstraints(constraints).catch(function(){});" +
        "  focusRing.style.left = (clientX - rect.left) + 'px';" +
        "  focusRing.style.top = (clientY - rect.top) + 'px';" +
        "  focusRing.classList.add('show');" +
        "  setTimeout(function(){ focusRing.classList.remove('show'); }, 650);" +
        "};" +
        "var lastPinchAt = 0;" +
        "var pinchStartDist = 0;" +
        "var pinchStartZoom = 1;" +
        "var touchDistance = function(a, b) {" +
        "  var dx = a.clientX - b.clientX;" +
        "  var dy = a.clientY - b.clientY;" +
        "  return Math.sqrt(dx * dx + dy * dy);" +
        "};" +
        "v.addEventListener('click', function(e) {" +
        "  if (Date.now() - lastPinchAt < 350) return;" +
        "  focusAt(e.clientX, e.clientY);" +
        "});" +
        "wrap.addEventListener('touchstart', function(e) {" +
        "  if (e.touches.length === 2) {" +
        "    pinchStartDist = touchDistance(e.touches[0], e.touches[1]);" +
        "    pinchStartZoom = zoomRatio;" +
        "    e.preventDefault();" +
        "  }" +
        "}, { passive: false });" +
        "wrap.addEventListener('touchmove', function(e) {" +
        "  if (e.touches.length === 2 && pinchStartDist > 0) {" +
        "    var d = touchDistance(e.touches[0], e.touches[1]);" +
        "    if (d > 0) {" +
        "      zoomRatio = pinchStartZoom * (d / pinchStartDist);" +
        "      applyZoom();" +
        "    }" +
        "    e.preventDefault();" +
        "  }" +
        "}, { passive: false });" +
        "var endPinch = function(e) {" +
        "  if (e.touches.length < 2) {" +
        "    if (pinchStartDist > 0) lastPinchAt = Date.now();" +
        "    pinchStartDist = 0;" +
        "  }" +
        "};" +
        "wrap.addEventListener('touchend', endPinch);" +
        "wrap.addEventListener('touchcancel', endPinch);" +
        "zoomInBtn.onclick = function() {" +
        "  zoomRatio = Math.min(maxZoom, zoomRatio * 1.25);" +
        "  applyZoom();" +
        "};" +
        "zoomOutBtn.onclick = function() {" +
        "  zoomRatio = Math.max(1, zoomRatio * 0.8);" +
        "  applyZoom();" +
        "};" +
        "var switchCamera = function() {" +
        "  if (flipBtn.disabled) return;" +
        "  var settings = {};" +
        "  try { settings = (track && track.getSettings) ? track.getSettings() : {}; } catch (e) {}" +
        "  var currentFacing = settings.facingMode === 'user' ? 'user' : 'environment';" +
        "  var nextFacing = currentFacing === 'user' ? 'environment' : 'user';" +
        "  var previousDeviceId = settings.deviceId || '';" +
        "  flipBtn.disabled = true;" +
        "  var stopCurrent = function() {" +
        "    if (v.srcObject && v.srcObject.getTracks) {" +
        "      v.srcObject.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} });" +
        "    }" +
        "    v.srcObject = null;" +
        "  };" +
        "  var openNext = function(stream) {" +
        "    if (wrap.__ydCancelled) { stream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); return; }" +
        "    openStream(stream);" +
        "    var actualFacing = '';" +
        "    try { actualFacing = (track && track.getSettings) ? (track.getSettings().facingMode || '') : ''; } catch (e) {}" +
        "    front = actualFacing ? actualFacing === 'user' : nextFacing === 'user';" +
        "    frontLbl.style.display = front ? 'block' : 'none';" +
        "    flipBtn.disabled = false;" +
        "  };" +
        "  var restore = function() {" +
        "    var constraints = previousDeviceId" +
        "      ? { video: { deviceId: { exact: previousDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }, audio: false }" +
        "      : { video: { facingMode: currentFacing, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }, audio: false };" +
        "    navigator.mediaDevices.getUserMedia(constraints).then(function(s) {" +
        "      if (wrap.__ydCancelled) { s.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); return; }" +
        "      openStream(s);" +
        "      flipBtn.disabled = false;" +
        "    }).catch(function(){ flipBtn.disabled = false; });" +
        "  };" +
        "  var requestNext = function() {" +
        "    return navigator.mediaDevices.getUserMedia({" +
        "      video: { facingMode: { exact: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }," +
        "      audio: false" +
        "    }).catch(function() {" +
        "      return navigator.mediaDevices.enumerateDevices().then(function(devs) {" +
        "        var cams = devs.filter(function(d){ return d.kind === 'videoinput'; });" +
        "        var preferred = cams.filter(function(c){ return nextFacing === 'user' ? /front|user/i.test(c.label) : /back|rear|environment/i.test(c.label); })[0];" +
        "        var different = cams.filter(function(c){ return c.deviceId && c.deviceId !== previousDeviceId; })[0];" +
        "        var target = preferred || different || cams[0];" +
        "        if (!target) throw new Error('Kamera lain tidak ditemukan.');" +
        "        return navigator.mediaDevices.getUserMedia({" +
        "          video: { deviceId: { exact: target.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }," +
        "          audio: false" +
        "        });" +
        "      });" +
        "    });" +
        "  };" +
        "  stopCurrent();" +
        "  requestNext().then(openNext).catch(function(){ restore(); });" +
        "};" +
        "flipBtn.onclick = switchCamera;" +
        "var startStream = function(mode) {" +
        "  return navigator.mediaDevices.getUserMedia({" +
        "    video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] }," +
        "    audio: false" +
        "  });" +
        "};" +
        "var openStream = function(stream) {" +
        "  v.srcObject = stream;" +
        "  bindTrack(stream);" +
        "  var play = v.play();" +
        "  if (play && play.catch) play.catch(function(){});" +
        "};" +
        "startStream(front ? 'user' : 'environment').then(function(stream){" +
        "if (wrap.__ydCancelled) { stream.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} }); return; }" +
        "openStream(stream);" +
        "var c = document.createElement('canvas');" +
        "onReady(v, wrap, c);" +
        "}, function(e) {" +
        "if (wrap.__ydCancelled) return;" +
        "stopWrap();" +
        "var name = (e && e.name) ? e.name : 'Error';" +
        "if (name === 'NotAllowedError' || name === 'SecurityError') onError('Izin kamera ditolak. Izinkan akses kamera di browser lalu coba lagi, atau gunakan input manual.');" +
        "else if (name === 'NotFoundError' || name === 'OverconstrainedError') onError('Kamera tidak ditemukan pada perangkat ini. Gunakan input manual.');" +
        "else if (name === 'NotReadableError') onError('Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.');" +
        "else onError('" + UserMessages.SCANNER_START + "');" +
        "});" +
        "} catch (err) {" +
        "if (typeof stopWrap === 'function') { stopWrap(); } else { wrap.remove(); st.remove(); }" +
        "onError('" + UserMessages.SCANNER_START + "');" +
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
        "var zoom = parseFloat(v.dataset.zoom || '1');" +
        "if (!isFinite(zoom) || zoom < 1) zoom = 1;" +
        "var hw = v.dataset.hwZoom === '1';" +
        "var crop = !hw && zoom > 1.0001;" +
        "var sw = crop ? Math.max(1, Math.round(v.videoWidth / zoom)) : v.videoWidth;" +
        "var sh = crop ? Math.max(1, Math.round(v.videoHeight / zoom)) : v.videoHeight;" +
        "if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }" +
        "var ctx = c.getContext('2d', { willReadFrequently: true });" +
        "if (crop) {" +
        "  var sx = Math.max(0, Math.round((v.videoWidth - sw) / 2));" +
        "  var sy = Math.max(0, Math.round((v.videoHeight - sh) / 2));" +
        "  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);" +
        "} else {" +
        "  ctx.drawImage(v, 0, 0, sw, sh);" +
        "}" +
        "try { var d = ctx.getImageData(0, 0, c.width, c.height); } catch (e) { return null; }" +
        "var r = decodeFn(d.data, d.width, d.height);" +
        "return r ? r.data : null;" +
        "}",
)
private external fun jsDecodeFrame(decodeFn: JsAny?, canvas: JsAny?, video: JsAny?): JsString?

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(wrap) => {" +
        "var cleanup = function(el) {" +
        "  if (!el) return;" +
        "  if (el.__ydStop) { el.__ydStop(); return; }" +
        "  el.__ydCancelled = true;" +
        "  var v = el.querySelector ? el.querySelector('video') : null;" +
        "  if (v && v.srcObject && v.srcObject.getTracks) {" +
        "    v.srcObject.getTracks().forEach(function(t){ try { t.stop(); } catch (e) {} });" +
        "  }" +
        "  if (el.parentNode) el.parentNode.removeChild(el);" +
        "};" +
        "if (wrap) {" +
        "  cleanup(wrap);" +
        "} else {" +
        "  var all = document.querySelectorAll('[data-yd-scan-wrap]');" +
        "  for (var i = 0; i < all.length; i++) cleanup(all[i]);" +
        "}" +
        "if (!document.querySelector('[data-yd-scan-wrap]')) {" +
        "  var css = document.querySelector('style[data-yd-scan]');" +
        "  if (css) css.remove();" +
        "}" +
        "}",
)
private external fun jsStopCamera(wrap: JsAny?)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(decodeFn) => {" +
        "return new Promise(function(resolve, reject){" +
        "var input = document.createElement('input');" +
        "input.type = 'file';" +
        "input.accept = 'image/*';" +
        "input.style.display = 'none';" +
        "document.body.appendChild(input);" +
        "input.onchange = function(){" +
        "var file = input.files && input.files[0];" +
        "if (!file) { input.remove(); resolve(null); return; }" +
        "var reader = new FileReader();" +
        "reader.onload = function(ev){" +
        "var img = new Image();" +
        "img.onload = function(){" +
        "try {" +
        "var c = document.createElement('canvas');" +
        "var scale = Math.min(1.0, 1600 / Math.max(img.width, img.height));" +
        "c.width = Math.round(img.width * scale);" +
        "c.height = Math.round(img.height * scale);" +
        "var ctx = c.getContext('2d', { willReadFrequently: true });" +
        "ctx.drawImage(img, 0, 0, c.width, c.height);" +
        "var d = ctx.getImageData(0, 0, c.width, c.height);" +
        "var r = decodeFn(d.data, d.width, d.height);" +
        "input.remove();" +
        "resolve(r ? r.data : null);" +
        "} catch (err) { input.remove(); reject(err); }" +
        "};" +
        "img.onerror = function(){ input.remove(); reject(new Error('Foto tidak dapat dibaca.')); };" +
        "img.src = ev.target.result;" +
        "};" +
        "reader.onerror = function(){ input.remove(); reject(new Error('Foto tidak dapat dibaca.')); };" +
        "reader.readAsDataURL(file);" +
        "};" +
        "input.click();" +
        "});" +
        "}",
)
private external fun jsDecodeFile(decodeFn: JsAny?): JsString?
