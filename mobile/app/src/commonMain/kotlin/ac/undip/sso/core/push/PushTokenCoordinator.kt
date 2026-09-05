package ac.undip.sso.core.push

import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

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
 *  - [onNewToken] tracks a rotated token only while the coordinator's active
 *    session is live; while inactive the token is stashed for the next login
 *    (device-owned, retried later — never dropped). The active state and
 *    generation are coordinator-owned under the same mutex as registration.
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
    private var activeSession = false
    private var sessionGeneration = 0L

    var activeToken: String? = null
        private set

    /** Dipanggil saat sesi hidup (login / app start dengan token). */
    suspend fun onLogin(): String? =
        transition.withLock {
            if (!activeSession) {
                activeSession = true
                sessionGeneration += 1
            }
            val generation = sessionGeneration
            val token = registration.prepareLoginToken() ?: return@withLock null
            registerAndFinalize(token, generation)
        }

    /** Dipanggil saat FCM merotasi token (thread background di produksi). */
    suspend fun onNewToken(newToken: String): String? =
        transition.withLock {
            val generation = sessionGeneration
            if (!activeSession) {
                registration.stashPending(newToken)
                return@withLock null
            }
            val token = registration.prepareNewToken(newToken)
            registerAndFinalize(token, generation)
        }

    /** Dipanggil sebelum sesi lokal dihapus (bearer masih hidup). */
    suspend fun onLogout() {
        transition.withLock {
            val token = activeToken
            // End the generation before the backend call. Any callback queued
            // behind this transition can only stash for the next account.
            activeSession = false
            sessionGeneration += 1
            try {
                registration.onLogout(token)
            } finally {
                // Cancellation (or any throw) from the unregister must neither
                // retain the token nor strand the logout — the orchestrator's
                // localCleanup runs next and the CE still propagates to it.
                activeToken = null
            }
        }
    }

    /**
     * Registration is bounded by the platform HTTP client's request timeout.
     * NonCancellable only prevents the parent from interrupting the commit
     * window; it does not remove that transport-level timeout.
     */
    private suspend fun registerAndFinalize(token: String, generation: Long): String? {
        val registered = withContext(NonCancellable) {
            if (!registration.registerOnBackend(token)) {
                return@withContext null
            }

            if (activeSession && sessionGeneration == generation) {
                activeToken = token
                registration.clearPending(token)
            }
            token
        }
        currentCoroutineContext().ensureActive()
        return registered
    }
}
