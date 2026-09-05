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
    private var coordinator: PushTokenCoordinator? = null

    val activeToken: String?
        get() = coordinator?.activeToken

    val registration: PushRegistration
        get() = checkNotNull(coordinator?.registration) { "PushGraph not installed" }

    /** Riwayat push yang pernah diterima (disimpan lokal, non-PII). */
    var history: NotificationHistoryStore? = null
        private set

    fun install(context: Context) {
        if (coordinator != null) return
        val appContext = context.applicationContext
        history = DataStoreNotificationHistoryStore(appContext)
        coordinator =
            PushTokenCoordinator(
                PushRegistration(
                    object : PushRegistration.Ops {
                    override suspend fun currentFcmToken(): String? = firebaseToken()

                    // runCatching: offline/5xx TIDAK boleh melempar keluar
                    // (coroutine tak tertangani = crash). false = gagal daftar
                    // → jalur stash-pending yang menangani retry.
                    override suspend fun registerOnBackend(token: String): Boolean =
                        runCatching {
                            Backend.api.registerPushDevice(PushDeviceRequest(token)).ok
                        }.getOrDefault(false)

                    override suspend fun unregisterOnBackend(token: String): Boolean =
                        backendUnregisterCatching {
                            Backend.api.unregisterPushDevice(PushDeviceRequest(token)).ok
                        }

                    override suspend fun stashPending(token: String) {
                        appContext.pushDataStore.edit { it[PENDING_KEY] = token }
                    }

                    override suspend fun readPending(): String? =
                        appContext.pushDataStore.data.first()[PENDING_KEY]

                    override suspend fun clearPending() {
                        appContext.pushDataStore.edit { it.remove(PENDING_KEY) }
                    }
                    },
                ),
            )
    }

    /** Dipanggil AppRoot saat hasToken menjadi true. */
    suspend fun onLogin(): String? = coordinator?.onLogin()

    /** Dipanggil PushMessagingService.onNewToken (thread background). */
    suspend fun onNewToken(newToken: String, loggedIn: Boolean) {
        coordinator?.onNewToken(newToken, loggedIn)
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
