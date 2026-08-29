package ac.undip.sso.ui

import ac.undip.sso.core.data.NoOpPersistentCache
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.push.IdbNotificationHistoryStore
import ac.undip.sso.core.push.PushSubscriptionManager
import ac.undip.sso.core.push.StoredNotification
import ac.undip.sso.core.push.normalizeNavTarget
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import androidx.compose.runtime.*
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json

@Composable
fun AppRoot(themeController: ThemeController) {
    val tokenStore = remember { TokenStore() }
    // Riwayat push PWA (IndexedDB `sso_notif`) — DB yang sama dengan yang
    // ditulis service worker, jadi notifikasi yang diterima saat app tertutup
    // ikut terbaca. (Web Storage tidak tersedia di service worker, Task 6 fix.)
    val history = remember { IdbNotificationHistoryStore() }
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    var pendingNav by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tokenStore) {
        val t = tokenStore.currentToken()
        if (t != null) Backend.authToken = t
        hasToken = t != null
        checked = true
    }

    // Live push/nav dari service worker (postMessage):
    //  - {type:'sso_push', toast} -> tambahkan ke riwayat IDB (tab memang terbuka,
    //    SW menyimpan juga — dedup di mergeNotification tetap berlaku karena id
    //    'title|body' dari toast SW ikut ter-decode dan dipertahankan);
    //  - {type:'sso_nav', target} -> arahkan tab ke tugas/jadwal seketika.
    // Listener didaftarkan sekali untuk umur app (root tidak pernah di-leave);
    // wasm single-threaded, jadi mutasi state dari event handler aman.
    LaunchedEffect(Unit) {
        jsListenPushMessages { kind, payload ->
            when (kind?.toString()) {
                "push" -> runCatching {
                    val toast = pushToastJson.decodeFromString(StoredNotification.serializer(), payload?.toString() ?: "")
                    GlobalScope.launch { history.append(toast) }
                }
                "nav" -> normalizeNavTarget(payload?.toString())?.let { pendingNav = it }
                else -> Unit
            }
        }
    }

    // PWA lifecycle pasca-login:
    //  1. Konsumsi target navigasi tap-notifikasi yang ditulis SW
    //     (notificationclick -> IndexedDB record 'pendingNav', sekali pakai).
    //  2. Daftarkan (atau periksa ulang) subscription Web Push ke backend
    //     — best-effort: push permission ditolak / VAPID belum dikonfigurasi /
    //     offline → skip senyap, PWA tetap berfungsi (cuma tanpa push).
    LaunchedEffect(hasToken) {
        if (!hasToken) return@LaunchedEffect
        pendingNav = normalizeNavTarget(runCatching { history.consumePendingNav() }.getOrNull())
            runCatching {
                if (!PushSubscriptionManager.isSupported()) return@runCatching
                val vapid = Backend.api.vapidPublicKey().publicKey
                if (vapid.isBlank()) return@runCatching
                // `navigator.serviceWorker.ready` never settles bila tidak ada SW
                // terdaftar — beri timeout supaya login tidak menggantung.
                val sub = withTimeoutOrNull(10_000) { PushSubscriptionManager.subscribe(vapid) }
                sub?.let { Backend.api.registerWebPushDevice(it) }
            }
    }

    if (!checked) return

    if (hasToken) {
        AppShell(
            tokenStore = tokenStore,
            persistentCache = NoOpPersistentCache,
            themeController = themeController,
            onLogout = {
                GlobalScope.launch {
                    // URUTAN: unregister harus jalan SELAMA Backend.authToken
                    // masih terpasang (DELETE web-device butuh Bearer). Cabut
                    // subscription dulu, baru token dibersihkan.
                    runCatching {
                        PushSubscriptionManager.currentSubscription()
                            ?.let { Backend.api.unregisterWebPushDevice(it) }
                        PushSubscriptionManager.unsubscribe()
                    }
                    // Privasi: riwayat notifikasi IDB global (bukan per-NIM) — user B
                    // tidak boleh melihat notifikasi user A. Kosongkan di logout.
                    runCatching { history.clear() }
                    Backend.authToken = null
                    tokenStore.clear()
                    hasToken = false
                }
            },
            initialNavTarget = pendingNav,
            onNavConsumed = {
                pendingNav = null
                // Hapus sisa record 'pendingNav' juga supaya F5 tidak double-nav.
                GlobalScope.launch { runCatching { history.consumePendingNav() } }
            },
            notificationHistory = history,
        )
    } else {
        LoginScreen(
            tokenStore = tokenStore,
            onLoggedIn = { hasToken = true },
        )
    }
}

/** JSON decoder untuk toast yang dibungkus SW lewat postMessage (sama dengan IDB). */
private val pushToastJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
}

// ---------- interop primitives (implementasi JS) ----------

/**
 * Daftarkan satu `message` listener untuk pesan dari service worker
 * (`self.clients...postMessage`). Per spec Service Workers, pesan yang dikirim
 * `client.postMessage()` diantarkan sebagai event `message` DI
 * `ServiceWorkerContainer` — bukan di `window` — jadi listener didaftarkan di
 * `navigator.serviceWorker` (tanpa ini kanal sso_push/sso_nav mati total).
 * Callback menerima (kind, payload):
 *  - ('push', JSON.stringify(toast))  — toast = {id,title,body,target,payload,receivedAt}
 *  - ('nav', target)                  — target = 'tasks' | 'schedule' | ''
 *
 * Idempotent: dev hot-reload / re-registration me-remove handler lama di
 * `window.__ssoPushMsgHandler` sebelum menambah yang baru, jadi listener
 * tidak pernah menumpuk (setiap pesan SW hanya diproses sekali).
 */
@OptIn(ExperimentalWasmJsInterop::class)
@JsFun(
    "(cb) => {" +
        "if (!navigator.serviceWorker) return;" +
        "var prev = window.__ssoPushMsgHandler;" +
        "if (prev) navigator.serviceWorker.removeEventListener('message', prev);" +
        "var fn = function (ev) {" +
        "  var d = ev.data;" +
        "  if (!d || typeof d !== 'object' || !d.type) return;" +
        "  if (d.type === 'sso_push' && d.toast) cb('push', JSON.stringify(d.toast));" +
        "  else if (d.type === 'sso_nav') cb('nav', d.target ? String(d.target) : '');" +
        "};" +
        "window.__ssoPushMsgHandler = fn;" +
        "navigator.serviceWorker.addEventListener('message', fn);" +
        "}",
)
private external fun jsListenPushMessages(cb: (JsAny?, JsAny?) -> Unit)
