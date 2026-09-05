package ac.undip.sso.core.push

/**
 * Constructible token/logout lifecycle coordinator over a [PushRegistration].
 *
 * Holds the active device token as ordinary instance state (no singleton):
 * tests build one per case through normal DI with a fake
 * [PushRegistration.Ops], so suites isolate state without reflection or
 * companion-singleton contamination. Production Android wiring ([PushGraph])
 * owns exactly one app-scope instance and delegates to it — thin glue, same
 * behavior.
 *
 * LIFECYCLE:
 *  - [onLogin] registers the current FCM token (pending stash first) and
 *    tracks the registered token as active.
 *  - [onNewToken] tracks a rotated token only while logged in; while logged
 *    out the token is stashed for the next login (device-owned, retried
 *    later — never dropped).
 *  - [onLogout] unregisters the active token (no-op without one) and ALWAYS
 *    clears it in a `finally`: success, ordinary backend `false`, an
 *    unexpected throw (propagates), or structured cancellation
 *    (rethrows AND clears — cancellation must neither retain the token nor
 *    strand the logout; only the [ac.undip.sso.core.data.SessionLogout]
 *    orchestrator decides what is best-effort).
 */
class PushTokenCoordinator(val registration: PushRegistration) {
    var activeToken: String? = null
        private set

    /** Dipanggil saat sesi hidup (login / app start dengan token). */
    suspend fun onLogin(): String? {
        val t = registration.onLogin()
        if (t != null) activeToken = t
        return t
    }

    /** Dipanggil saat FCM merotasi token (thread background di produksi). */
    suspend fun onNewToken(newToken: String, loggedIn: Boolean): String? {
        val registered = registration.onNewToken(newToken, loggedIn)
        if (registered != null && loggedIn) activeToken = registered
        return registered
    }

    /** Dipanggil sebelum sesi lokal dihapus (bearer masih hidup). */
    suspend fun onLogout() {
        try {
            registration.onLogout(activeToken)
        } finally {
            // Cancellation (or any throw) from the unregister must neither
            // retain the token nor strand the logout — the orchestrator's
            // localCleanup runs next and the CE still propagates to it.
            activeToken = null
        }
    }
}
