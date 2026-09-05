package ac.undip.sso.core.push

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/**
 * Logika murni lifecycle token FCM terhadap registry backend
 * (POST/DELETE /api/notifications/device). Semua I/O disuntik lewat [Ops].
 */
class PushRegistration(private val ops: Ops) {
    interface Ops {
        suspend fun currentFcmToken(): String?
        suspend fun registerOnBackend(token: String): Boolean
        suspend fun unregisterOnBackend(token: String): Boolean
        suspend fun stashPending(token: String)
        suspend fun readPending(): String?
        suspend fun clearPending(expectedToken: String)
    }

    /** Login sukses / app start dgn sesi hidup. Pending didahulukan. */
    suspend fun onLogin(): String? {
        val pending = ops.readPending()
        val token = pending ?: ops.currentFcmToken() ?: return null
        if (pending == null) {
            stashBeforeRegistration(token)
        }
        return registerToken(token)
    }

    /** Rotasi token saat app hidup. */
    suspend fun onNewToken(newToken: String): String? {
        stashBeforeRegistration(newToken)
        return registerToken(newToken)
    }

    /** Stash a device token without registering it for the inactive account. */
    suspend fun stashPending(token: String) {
        ops.stashPending(token)
    }

    /** Clear only the pending value that was just registered. */
    suspend fun clearPending(token: String) {
        withContext(NonCancellable) {
            ops.clearPending(token)
        }
    }

    /**
     * Logout: cabut token device dari registry. Pending stash DIPERTAHANKAN —
     * token milik device, bukan akun.
     */
    suspend fun onLogout(activeToken: String?) {
        if (activeToken != null) ops.unregisterOnBackend(activeToken)
    }

    private suspend fun registerCatching(token: String): Boolean =
        try {
            ops.registerOnBackend(token)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            false
        }

    private suspend fun registerToken(token: String): String? =
        if (registerCatching(token)) token else null

    private suspend fun stashBeforeRegistration(token: String) {
        withContext(NonCancellable) {
            ops.stashPending(token)
        }
    }
}
