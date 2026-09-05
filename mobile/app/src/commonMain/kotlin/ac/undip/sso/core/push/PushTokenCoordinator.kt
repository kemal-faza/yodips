package ac.undip.sso.core.push

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

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
 *
 * SERIALIZATION: the three transitions share one per-instance [Mutex] held
 * across the backend registration/unregistration AND the [activeToken]
 * finalization. A rotation/login racing a paused logout waits instead of
 * interleaving a backend register between the logout's unregister and its
 * token nulling (which would orphan a backend-registered token nobody
 * tracks, or let the logout's `finally` wipe a freshly tracked token).
 * [Mutex.withLock] releases on exception/cancellation, and the logout's
 * inner `finally` still nulls the token under the lock — cancellation
 * rethrows with state finalized either way. A caller cancelled while QUEUED
 * on the lock never entered the transition: it rethrows without touching
 * the backend or [activeToken].
 */
class PushTokenCoordinator(val registration: PushRegistration) {
    private val transition = Mutex()
    var activeToken: String? = null
        private set

    /** Dipanggil saat sesi hidup (login / app start dengan token). */
    suspend fun onLogin(): String? =
        transition.withLock {
            val t = registration.onLogin()
            if (t != null) activeToken = t
            t
        }

    /** Dipanggil saat FCM merotasi token (thread background di produksi). */
    suspend fun onNewToken(newToken: String, loggedIn: Boolean): String? =
        transition.withLock {
            val registered = registration.onNewToken(newToken, loggedIn)
            if (registered != null && loggedIn) activeToken = registered
            registered
        }

    /** Dipanggil sebelum sesi lokal dihapus (bearer masih hidup). */
    suspend fun onLogout() {
        transition.withLock {
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
}
