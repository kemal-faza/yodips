package ac.undip.sso.ui

import ac.undip.sso.core.data.PersistentCache
import ac.undip.sso.core.data.SessionLogout
import ac.undip.sso.core.data.TokenStoreLike
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.SessionExpiredEvents
import ac.undip.sso.core.push.PushGraph
import ac.undip.sso.core.push.normalizeNavTarget
import ac.undip.sso.ui.login.LoginScreen
import ac.undip.sso.ui.shell.AppShell
import ac.undip.sso.ui.theme.ThemeController
import android.os.Build
import android.webkit.CookieManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Top-level: no-token → Login (WebView handoff); token → AppShell (5-tab).
 */
@Composable
fun AppRoot(
    tokenStore: TokenStoreLike,
    persistentCache: PersistentCache,
    themeController: ThemeController,
    pendingNavTarget: String? = null,
    onNavConsumed: () -> Unit = {},
) {
    var hasToken by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    // Hoisted to the root so its coroutines are NOT cancelled when the AppShell
    // branch is disposed — otherwise tokenStore.clear() gets cancelled mid-write
    // on logout and the persisted session survives a process restart.
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Android 13+: POST_NOTIFICATIONS harus diminta runtime. Setelah login,
    // bukan saat splash — user baru peduli notifikasi setelah masuk app.
    val notifPermLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(hasToken) {
        if (hasToken && Build.VERSION.SDK_INT >= 33) {
            notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // Sesi hidup → daftarkan/refresh token FCM ke registry backend (retry via
    // stash-pending di dalam PushRegistration bila offline).
    LaunchedEffect(hasToken) {
        if (hasToken) {
            PushGraph.install(context.applicationContext)
            withContext(Dispatchers.IO) { PushGraph.onLogin() }
        }
    }

    // Read the stored JWT once on startup and reattach it to the HTTP client
    // so Ktor sends `Authorization: Bearer` on every data call.
    LaunchedEffect(tokenStore) {
        val t = tokenStore.currentToken()
        if (t != null) Backend.authToken = t
        hasToken = t != null
        checked = true
    }

    if (!checked) return

    // Hoisted so both AppShell and the session-expired dialog can trigger it.
    // Clears the push-device registration, persisted session, HTTP bearer, any
    // WebView session cookies, and the session-expired signal so the next login
    // starts fresh (not auto-attached to the old part).
    //
    // ORDERING INVARIANT: PushGraph.onLogout() MUST run while Backend.authToken
    // is still set — DELETE /api/notifications/device needs the bearer.
    // Nulling the token first would send the request without auth → 401 → the
    // device token is never pruned in the backend registry.

    // Hoisted ONCE for the composable's lifetime: single-flight (requirement 2)
    // only spans invocations that share ONE SessionLogout instance — building
    // a fresh one per tap would create new single-flight state each time and
    // defeat it.
    val sessionLogout = remember {
        SessionLogout(
            pushUnregister = { PushGraph.onLogout() },
            revokeServerSession = { Backend.api.logout() },
            localCleanup = {
                // SUSPENDING, unconditional, runs LAST under NonCancellable
                // inside SessionLogout.logout() — both server calls above
                // already attempted with the (still-live) bearer. The
                // DataStore edit is AWAITED inline (never fire-and-forget):
                // a logout scope cancelled by Activity destruction mid-write
                // still completes the removal, so the persisted JWT cannot
                // survive to resurrect the session after restart. Durable
                // removal completes BEFORE the UI flips to login (last).
                tokenStore.clear() // durable: awaited DataStore edit, first
                Backend.authToken = null
                runCatching { CookieManager.getInstance().removeAllCookies(null) }
                SessionExpiredEvents.consume()
                hasToken = false
            },
        )
    }
    val onLogout: () -> Unit = {
        scope.launch { sessionLogout.logout() }
    }

    if (hasToken) {
        AppShell(
            tokenStore = tokenStore,
            persistentCache = persistentCache,
            themeController = themeController,
            onLogout = onLogout,
            initialNavTarget = normalizeNavTarget(pendingNavTarget),
            onNavConsumed = onNavConsumed,
            notificationHistory = PushGraph.history,
        )
    } else {
        LoginScreen(
            onLoggedIn = { hasToken = true },
            tokenStore = tokenStore,
        )
    }

    // Universal "session expired" dialog: fired by SsoRepository on ANY 401
    // (expired JWT or backend lost the upstream session), so a dead session
    // surfaces immediately instead of silently serving stale cache. It only
    // shows while the user is logged in (events are ignored post-logout), is
    // non-dismissible — the session is dead, the only way forward is re-login —
    // and its CTA reuses the normal logout path so the next login starts clean.
    val sessionExpired by SessionExpiredEvents.events.collectAsState()
    if (hasToken && sessionExpired > 0) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Sesi Berakhir") },
            text = {
                Text("Sesi login kamu sudah tidak valid. Klik Login Ulang untuk masuk kembali.")
            },
            confirmButton = {
                TextButton(onClick = onLogout) {
                    Text("Login Ulang")
                }
            },
        )
    }
}
