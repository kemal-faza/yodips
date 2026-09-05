package ac.undip.sso.core.push

import kotlinx.coroutines.CancellationException
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
        suspend fun clearPending()
    }

    /** Login sukses / app start dgn sesi hidup. Pending didahulukan. */
    suspend fun onLogin(): String? {
        val pending = ops.readPending()
        if (pending != null) {
            return try {
                if (registerCatching(pending)) {
                    ops.clearPending()
                    pending
                } else {
                    null
                }
            } catch (error: CancellationException) {
                preservePendingAndRethrow(pending, error)
            }
        }
        val fresh = ops.currentFcmToken() ?: return null
        return try {
            if (registerCatching(fresh)) {
                fresh
            } else {
                ops.stashPending(fresh)
                null
            }
        } catch (error: CancellationException) {
            preservePendingAndRethrow(fresh, error)
        }
    }

    /** Rotasi token saat app hidup. */
    suspend fun onNewToken(newToken: String): String? =
        try {
            if (registerCatching(newToken)) {
                newToken
            } else {
                ops.stashPending(newToken) // offline -> dicoba lagi saat login berikut
                null
            }
        } catch (error: CancellationException) {
            preservePendingAndRethrow(newToken, error)
        }

    /** Stash a device token without registering it for the inactive account. */
    suspend fun stashPending(token: String) {
        ops.stashPending(token)
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

    private suspend fun preservePendingAndRethrow(
        token: String,
        error: CancellationException,
    ): Nothing {
        withContext(kotlinx.coroutines.NonCancellable) {
            ops.stashPending(token)
        }
        throw error
    }
}
