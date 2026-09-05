package ac.undip.sso.core.push

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/** Ktor's request timeout is 30 seconds on every mobile target. */
internal const val DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS = 30_000L

internal fun requirePushOperationTimeout(timeoutMillis: Long) {
    require(timeoutMillis > 0) { "Push operation timeout must be positive" }
}

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
        val token = prepareLoginToken() ?: return null
        return if (registerOnBackend(token)) token else null
    }

    /** Rotasi token saat app hidup. */
    suspend fun onNewToken(newToken: String): String? {
        val token = prepareNewToken(newToken)
        return if (registerOnBackend(token)) token else null
    }

    /** Stash a device token without registering it for the inactive account. */
    suspend fun stashPending(token: String) {
        stashPending(token, DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS)
    }

    /** Stash using the coordinator's injected bound while it owns the lock. */
    internal suspend fun stashPending(token: String, timeoutMillis: Long) {
        stashBeforeRegistration(token, timeoutMillis)
    }

    /** Clear only the pending value that was just registered. */
    suspend fun clearPending(token: String) {
        clearPending(token, DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS)
    }

    /** Clear using the coordinator's injected bound while it owns the lock. */
    internal suspend fun clearPending(token: String, timeoutMillis: Long) {
        requirePushOperationTimeout(timeoutMillis)
        withContext(NonCancellable) {
            withTimeout(timeoutMillis) {
                ops.clearPending(token)
            }
        }
        currentCoroutineContext().ensureActive()
    }

    /** Prepare a login token and durably stash a fresh token before registration. */
    internal suspend fun prepareLoginToken(
        timeoutMillis: Long = DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS,
    ): String? {
        requirePushOperationTimeout(timeoutMillis)
        val pending = withTimeout(timeoutMillis) { ops.readPending() }
        val token = pending ?: withTimeout(timeoutMillis) { ops.currentFcmToken() } ?: return null
        if (pending == null) {
            stashBeforeRegistration(token, timeoutMillis)
        }
        return token
    }

    /** Durably stash a rotated token before it is registered for the live session. */
    internal suspend fun prepareNewToken(
        newToken: String,
        timeoutMillis: Long = DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS,
    ): String {
        stashBeforeRegistration(newToken, timeoutMillis)
        return newToken
    }

    /** Register a token while the coordinator owns the transition lock. */
    internal suspend fun registerOnBackend(
        token: String,
        timeoutMillis: Long = DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS,
    ): Boolean {
        requirePushOperationTimeout(timeoutMillis)
        val registered =
            try {
                withContext(NonCancellable) {
                    withTimeout(timeoutMillis) {
                        ops.registerOnBackend(token)
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                false
            }
        currentCoroutineContext().ensureActive()
        return registered
    }

    /**
     * Logout: cabut token device dari registry. Pending stash DIPERTAHANKAN —
     * token milik device, bukan akun.
     */
    suspend fun onLogout(
        activeToken: String?,
        timeoutMillis: Long = DEFAULT_PUSH_OPERATION_TIMEOUT_MILLIS,
    ) {
        if (activeToken != null) {
            requirePushOperationTimeout(timeoutMillis)
            withTimeout(timeoutMillis) { ops.unregisterOnBackend(activeToken) }
        }
    }

    private suspend fun stashBeforeRegistration(token: String, timeoutMillis: Long) {
        requirePushOperationTimeout(timeoutMillis)
        withContext(NonCancellable) {
            withTimeout(timeoutMillis) {
                ops.stashPending(token)
            }
        }
        currentCoroutineContext().ensureActive()
    }

}
