package ac.undip.sso.core.push

import ac.undip.sso.core.network.ApiClient
import ac.undip.sso.core.network.PushDeviceRequest
import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

private val Context.pushDataStore by preferencesDataStore(name = "sso_push")
private val PENDING_KEY = stringPreferencesKey("pending_fcm_token")

/**
 * Singleton glue app-scope: menyambungkan [PushRegistration] (pure) ke
 * Firebase/Retrofit/DataStore nyata. FCM token BUKAN secret (device-scoped,
 * dapat dirotasi server) → plaintext DataStore cukup; berbeda dari JWT yang
 * wajib terenkripsi di TokenStore.
 */
object PushGraph {
    @Volatile
    var activeToken: String? = null
        private set

    lateinit var registration: PushRegistration
        private set

    fun install(context: Context) {
        if (::registration.isInitialized) return
        val appContext = context.applicationContext
        registration =
            PushRegistration(
                object : PushRegistration.Ops {
                    override suspend fun currentFcmToken(): String? = firebaseToken()

                    // runCatching: offline/5xx TIDAK boleh melempar keluar
                    // (coroutine tak tertangani = crash). false = gagal daftar
                    // → jalur stash-pending yang menangani retry.
                    override suspend fun registerOnBackend(token: String): Boolean =
                        runCatching {
                            ApiClient.api.registerPushDevice(PushDeviceRequest(token)).ok
                        }.getOrDefault(false)

                    override suspend fun unregisterOnBackend(token: String): Boolean =
                        runCatching {
                            ApiClient.api.unregisterPushDevice(PushDeviceRequest(token)).ok
                        }.getOrDefault(false)

                    override suspend fun stashPending(token: String) {
                        appContext.pushDataStore.edit { it[PENDING_KEY] = token }
                    }

                    override suspend fun readPending(): String? =
                        appContext.pushDataStore.data.first()[PENDING_KEY]

                    override suspend fun clearPending() {
                        appContext.pushDataStore.edit { it.remove(PENDING_KEY) }
                    }
                },
            )
    }

    /** Dipanggil AppRoot saat hasToken menjadi true. */
    suspend fun onLogin(): String? {
        val t = registration.onLogin()
        if (t != null) activeToken = t
        return t
    }

    /** Dipanggil PushMessagingService.onNewToken (thread background). */
    suspend fun onNewToken(newToken: String, loggedIn: Boolean) {
        val registered = registration.onNewToken(newToken, loggedIn)
        if (registered != null && loggedIn) activeToken = registered
    }

    /** Dipanggil AppRoot.onLogout sebelum sesi lokal dihapus. */
    suspend fun onLogout() {
        registration.onLogout(activeToken)
        activeToken = null
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
