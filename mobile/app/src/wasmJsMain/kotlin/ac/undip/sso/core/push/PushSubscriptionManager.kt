package ac.undip.sso.core.push

import ac.undip.sso.core.network.WebPushDeviceRequest
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlin.coroutines.resume

/**
 * Web Push subscription management untuk PWA (wasmJs) — dependency-free
 * (tidak menyentuh chrome.*), semua browser interop lewat [JsFun] di bawah.
 *
 * Aliran (dipanggil AppRoot.wasmJs):
 *  - login: [subscribe] dengan VAPID public key backend → subscription
 *    (existing ATAU baru) → JSON `{endpoint,p256dh,auth}` → didaftarkan ke
 *    POST /api/notifications/web-device.
 *  - logout: [currentSubscription] dipakai untuk DELETE web-device, lalu
 *    [unsubscribe] memberhentikan subscription browser.
 *
 * Semua operasi best-effort: kegagalan (permission denied, backend belum
 * mengonfigurasi VAPID, SW belum aktif) menghasilkan null/false, bukan
 * error yang menggagalkan login.
 */
object PushSubscriptionManager {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    /** True bila browser punya service worker CLIENTS + PushManager (secure context). */
    fun isSupported(): Boolean = jsPushSupported()

    /**
     * Ambil subscription yang sudah ada, atau buat baru (memicu prompt izin
     * bila belum pernah ditanya). Berhasil/null — gagal melempar RuntimeException.
     */
    suspend fun subscribe(vapidPublicKey: String): WebPushDeviceRequest? =
        suspendCancellableCoroutine { cont ->
            jsPushSubscription(
                /* createIfMissing = */ true,
                vapidPublicKey,
                onOk = { raw ->
                    if (cont.isActive) cont.resume(parseSubscription(raw?.toString()), onCancellation = null)
                },
                onFail = { err ->
                    if (cont.isActive) cont.resumeWith(Result.failure(RuntimeException(jsErrText(err)?.toString() ?: "unknown error")))
                },
            )
        }

    /** Subscription aktif saat ini (tanpa memicu prompt/permintaan izin). */
    suspend fun currentSubscription(): WebPushDeviceRequest? =
        suspendCancellableCoroutine { cont ->
            jsPushSubscription(
                /* createIfMissing = */ false,
                "",
                onOk = { raw ->
                    if (cont.isActive) cont.resume(parseSubscription(raw?.toString()), onCancellation = null)
                },
                onFail = { err ->
                    if (cont.isActive) cont.resumeWith(Result.failure(RuntimeException(jsErrText(err)?.toString() ?: "unknown error")))
                },
            )
        }

    /** Best-effort unsubscribe; true hanya bila subscription benar-benar dicabut. */
    suspend fun unsubscribe(): Boolean =
        suspendCancellableCoroutine { cont ->
            jsUnsubscribe { ok ->
                if (cont.isActive) cont.resume(ok?.toString() == "1", onCancellation = null)
            }
        }

    private fun parseSubscription(raw: String?): WebPushDeviceRequest? {
        if (raw.isNullOrBlank()) return null
        return runCatching { json.decodeFromString<WebPushDeviceRequest>(raw) }.getOrNull()
    }
}

// ---------- interop primitives (implementasi JS) ----------

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("() => (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) ? true : false")
private external fun jsPushSupported(): Boolean

/**
 * Satu JsFun untuk dua mode:
 *  - createIfMissing = true  -> subscription existing ATAU subscribe baru (VAPID key)
 *  - createIfMissing = false -> cuma baca existing (vapidPublicKey tak dipakai)
 * onOk menerima JSON string `{endpoint,p256dh,auth}` (base64url p256dh/auth)
 * atau null bila tidak ada subscription. onFail menerima pesan error.
 */
@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(createIfMissing, vapidPublicKey, onOk, onFail) => {" +
        "function fail(err) { onFail(err && err.message ? err.message : String(err)); }" +
        "function urlBase64ToUint8Array(b64) {" +
        "  var padding = '='.repeat((4 - (b64.length % 4)) % 4);" +
        "  var base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');" +
        "  var raw = atob(base64);" +
        "  var out = new Uint8Array(raw.length);" +
        "  for (var i = 0; i < raw.length; i++) { out[i] = raw.charCodeAt(i); }" +
        "  return out;" +
        "}" +
        "function bufToBase64(buf) {" +
        "  if (!buf) return '';" +
        "  var bytes = new Uint8Array(buf);" +
        "  var bin = '';" +
        "  for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }" +
        "  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');" +
        "}" +
        "function toJson(sub) {" +
        "  return JSON.stringify({ endpoint: sub.endpoint, p256dh: bufToBase64(sub.getKey('p256dh')), auth: bufToBase64(sub.getKey('auth')) });" +
        "}" +
        "if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) { onFail('Web Push tidak didukung browser ini'); return; }" +
        "if (createIfMissing && !vapidPublicKey) { onFail('VAPID public key tidak tersedia'); return; }" +
        "navigator.serviceWorker.ready.then(function(reg) {" +
        "  if (!reg.pushManager) { onFail('PushManager tidak tersedia'); return; }" +
        "  reg.pushManager.getSubscription().then(function(existing) {" +
        "    if (existing) { onOk(toJson(existing)); return; }" +
        "    if (!createIfMissing) { onOk(null); return; }" +
        "    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }).then(function(sub) {" +
        "      onOk(toJson(sub));" +
        "    }).catch(fail);" +
        "  }).catch(fail);" +
        "}).catch(fail);" +
        "}",
)
private external fun jsPushSubscription(
    createIfMissing: Boolean,
    vapidPublicKey: String,
    onOk: (JsAny?) -> Unit,
    onFail: (JsAny?) -> Unit,
)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(onOk) => {" +
        "function fin(v) { onOk(v ? '1' : '0'); }" +
        "if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) { fin(false); return; }" +
        "navigator.serviceWorker.ready.then(function(reg) {" +
        "  if (!reg.pushManager) { fin(false); return; }" +
        "  reg.pushManager.getSubscription().then(function(sub) {" +
        "    if (!sub) { fin(false); return; }" +
        "    sub.unsubscribe().then(fin).catch(function() { fin(false); });" +
        "  }).catch(function() { fin(false); });" +
        "}).catch(function() { fin(false); });" +
        "}",
)
private external fun jsUnsubscribe(onOk: (JsAny?) -> Unit)

@OptIn(ExperimentalWasmJsInterop::class)
@JsFun("(e) => { if (!e) return 'unknown error'; if (e.message) return e.message; return String(e); }")
private external fun jsErrText(err: JsAny?): JsString?
