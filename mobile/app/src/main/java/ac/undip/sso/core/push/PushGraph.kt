package ac.undip.sso.core.push

import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.PushDeviceRequest
import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

private val Context.pushDataStore by preferencesDataStore(name = "sso_push")
private val PENDING_KEY = stringPreferencesKey("pending_fcm_token")

/**
 * Backend-unregister wrapper for the logout path: ordinary network/HTTP
 * failures (offline, 5xx, 401) map to `false` (best-effort prune — the
 * [SessionLogout] orchestrator continues to revoke + cleanup), while
 * structured [CancellationException] is explicitly rethrown so a cancelled
 * logout propagates instead of being misreported as "offline". (`runCatching`
 * would swallow cancellation — hence the explicit catches.)
 */
internal suspend fun backendUnregisterCatching(call: suspend () -> Boolean): Boolean {
    try {
        return call()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        return false
    }
}

/**
 * Backend-register wrapper: ordinary failures become a retryable `false`,
 * but structured cancellation must propagate to the lifecycle caller.
 */
internal suspend fun backendRegisterCatching(call: suspend () -> Boolean): Boolean {
    try {
        return call()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        return false
    }
}

/**
 * Idempotent once-gate behind [PushGraph.install]: collapses concurrent
 * first installs into a single build and publishes only a fully-built
 * value. Pure + JVM-testable (see PushInstallOnceTest): no Context,
 * Backend, or Firebase enters here, so tests construct their own instance
 * — never the [PushGraph] global, never reflection.
 *
 * Implementation is a JVM `synchronized` double-check: this file is
 * Android-only, and the guarded build is non-suspending. A throwing build
 * does NOT latch (the next ensure retries) so a transient install failure
 * stays visible instead of wedging the graph uninstalled.
 */
internal class PushInstallOnce {
    private val lock = Any()

    @Volatile
    private var done = false

    fun ensure(build: () -> Unit) {
        if (done) return
        synchronized(lock) {
            if (done) return
            build()
            done = true
        }
    }
}
/**
 * Singleton glue app-scope: menyambungkan [PushRegistration] (pure) ke
 * Firebase/Retrofit/DataStore nyata. FCM token BUKAN secret (device-scoped,
 * dapat dirotasi server) → plaintext DataStore cukup; berbeda dari JWT yang
 * wajib terenkripsi di TokenStore.
 *
 * Thin wiring over [PushTokenCoordinator] (the constructible, unit-tested
 * lifecycle owner): this object only builds the real [PushRegistration.Ops]
 * once and delegates. All lifecycle behavior (active-token tracking,
 * finally-clear on logout, cancellation propagation) lives in the
 * coordinator — never mutated by tests.
 */
object PushGraph {
    private val installOnce = PushInstallOnce()

    @Volatile
    private var coordinator: PushTokenCoordinator? = null

    val activeToken: String?
        get() = coordinator?.activeToken

    val registration: PushRegistration
        get() = checkNotNull(coordinator?.registration) { "PushGraph not installed" }

    /** Riwayat push yang pernah diterima (disimpan lokal, non-PII). */
    @Volatile
    var history: NotificationHistoryStore? = null
        private set

    /**
     * Idempotent + thread-safe: safe to call from `SsoApplication.onCreate`,
     * `MainActivity.onCreate`, AND `PushMessagingService.onNewToken` (a fresh
     * process can deliver an FCM rotation before any activity runs). Only
     * the first call builds; the coordinator is fully constructed before
     * publication, so readers never observe a half-built graph.
     */
    fun install(context: Context) {
        installOnce.ensure {
            val appContext = context.applicationContext
            history = DataStoreNotificationHistoryStore(appContext)
            coordinator =
                PushTokenCoordinator(
                    PushRegistration(
                        object : PushRegistration.Ops {
                    override suspend fun currentFcmToken(): String? = firebaseToken()

                    override suspend fun registerOnBackend(token: String): Boolean =
                        backendRegisterCatching {
                            Backend.api.registerPushDevice(PushDeviceRequest(token)).ok
                        }

                    override suspend fun unregisterOnBackend(token: String): Boolean =
                        backendUnregisterCatching {
                            Backend.api.unregisterPushDevice(PushDeviceRequest(token)).ok
                        }

                    override suspend fun stashPending(token: String) {
                        appContext.pushDataStore.edit { it[PENDING_KEY] = token }
                    }

                    override suspend fun readPending(): String? =
                        appContext.pushDataStore.data.first()[PENDING_KEY]

                    override suspend fun clearPending(expectedToken: String) {
                        appContext.pushDataStore.edit {
                            if (it[PENDING_KEY] == expectedToken) it.remove(PENDING_KEY)
                        }
                    }
                    },
                ),
            )
        }
    }

    /** Dipanggil AppRoot saat hasToken menjadi true. */
    suspend fun onLogin(): String? = coordinator?.onLogin()

    /** Dipanggil PushMessagingService.onNewToken (thread background). */
    suspend fun onNewToken(newToken: String) {
        coordinator?.onNewToken(newToken)
    }

    /** Simpan notifikasi yang baru diterima ke riwayat lokal (fire-and-forget). */
    fun recordReceived(
        title: String,
        body: String,
        target: String?,
        payload: String?,
    ) {
        val store = history ?: return
        ioScope.launch {
            store.append(
                StoredNotification(
                    title = title,
                    body = body,
                    target = target.orEmpty(),
                    payload = payload.orEmpty(),
                    receivedAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    /** Dipanggil AppRoot.onLogout sebelum sesi lokal dihapus. */
    suspend fun onLogout() {
        coordinator?.onLogout()
    }

    private suspend fun firebaseToken(): String? =
        withContext(Dispatchers.IO) {
            runCatching {
                suspendCancellableCoroutine { cont ->
                    FirebaseMessaging.getInstance().token
                        .addOnSuccessListener { cont.resume(it) }
                        .addOnFailureListener { cont.resume(null) }
                }
            }.getOrNull()
        }

    /** Scope utilitas utk pemanggilan fire-and-forget dari service. */
    val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
}
