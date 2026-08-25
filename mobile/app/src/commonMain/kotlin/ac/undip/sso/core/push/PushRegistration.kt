package ac.undip.sso.core.push

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
            if (ops.registerOnBackend(pending)) {
                ops.clearPending()
                return pending
            }
            return null
        }
        val fresh = ops.currentFcmToken() ?: return null
        return if (ops.registerOnBackend(fresh)) {
            fresh
        } else {
            ops.stashPending(fresh)
            null
        }
    }

    /** Rotasi token saat app hidup. */
    suspend fun onNewToken(newToken: String, loggedIn: Boolean): String? {
        if (!loggedIn) {
            ops.stashPending(newToken)
            return null
        }
        return if (ops.registerOnBackend(newToken)) {
            newToken
        } else {
            ops.stashPending(newToken) // offline -> dicoba lagi saat login berikut
            null
        }
    }

    /**
     * Logout: cabut token device dari registry. Pending stash DIPERTAHANKAN —
     * token milik device, bukan akun.
     */
    suspend fun onLogout(activeToken: String?) {
        if (activeToken != null) ops.unregisterOnBackend(activeToken)
    }
}
