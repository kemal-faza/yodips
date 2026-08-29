package ac.undip.sso.ui

import ac.undip.sso.core.data.NoOpPersistentCache
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.push.LocalStorageNotificationHistoryStore
import ac.undip.sso.core.push.PushSubscriptionManager
import ac.undip.sso.core.push.normalizeNavTarget
import ac.undip.sso.core.session.TokenStore
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import androidx.compose.runtime.*
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

@Composable
fun AppRoot(themeController: ThemeController) {
    val tokenStore = remember { TokenStore() }
    // Riwayat push PWA (localStorage) — key sama dengan yang ditulis service
    // worker, jadi notifikasi yang terima saat app tertutup ikut terbaca.
    val history = remember { LocalStorageNotificationHistoryStore() }
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    var pendingNav by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(tokenStore) {
        val t = tokenStore.currentToken()
        if (t != null) Backend.authToken = t
        hasToken = t != null
        checked = true
    }

    // PWA lifecycle pasca-login:
    //  1. Konsumsi target navigasi tap-notifikasi yang ditulis SW
    //     (notificationclick -> localStorage `sso_pending_nav`).
    //  2. Daftarkan (atau periksa ulang) subscription Web Push ke backend
    //     — best-effort: push permission ditolak / VAPID belum dikonfigurasi /
    //     offline → skip senyap, PWA tetap berfungsi (cuma tanpa push).
    LaunchedEffect(hasToken) {
        if (!hasToken) return@LaunchedEffect
        readPendingNav()?.let { pendingNav = normalizeNavTarget(it) }
        runCatching {
            if (!PushSubscriptionManager.isSupported()) return@runCatching
            val vapid = Backend.api.vapidPublicKey().publicKey
            if (vapid.isBlank()) return@runCatching
            PushSubscriptionManager.subscribe(vapid)?.let { Backend.api.registerWebPushDevice(it) }
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
                    Backend.authToken = null
                    tokenStore.clear()
                    hasToken = false
                }
            },
            initialNavTarget = pendingNav,
            onNavConsumed = { pendingNav = null },
            notificationHistory = history,
        )
    } else {
        LoginScreen(
            tokenStore = tokenStore,
            onLoggedIn = { hasToken = true },
        )
    }
}

/** Baca + hapus target navigasi yang ditinggalkan SW (sekali pakai). */
private fun readPendingNav(): String? {
    val raw = jsLocalStorageGetItem(PENDING_NAV_KEY)
    if (raw != null) jsLocalStorageRemoveItem(PENDING_NAV_KEY)
    return raw
}

private const val PENDING_NAV_KEY = "sso_pending_nav"

@JsFun("(key) => localStorage.getItem(key)")
private external fun jsLocalStorageGetItem(key: String): String?

@JsFun("(key) => localStorage.removeItem(key)")
private external fun jsLocalStorageRemoveItem(key: String)
