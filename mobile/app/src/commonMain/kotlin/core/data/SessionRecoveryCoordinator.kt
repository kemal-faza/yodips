package ac.undip.sso.core.data

import ac.undip.sso.core.network.RenewalContractFailure
import ac.undip.sso.core.network.ApiHttpException
import ac.undip.sso.core.network.BackendCodes
import ac.undip.sso.core.network.UpstreamSessionRenewal
import ac.undip.sso.core.network.UpstreamSessionRenewalException
import ac.undip.sso.core.network.UpstreamSessionService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.NonCancellable

/** Result of the platform-specific direct-ticket capture. */
sealed interface DirectTicketCaptureResult {
    /** Returned only after the capture adapter verifies an authenticated landing. */
    data class Authenticated(val cookie: String) : DirectTicketCaptureResult

    data object InteractionRequired : DirectTicketCaptureResult
    data object NetworkFailure : DirectTicketCaptureResult
    data object UpstreamInvalid : DirectTicketCaptureResult
    data object Unsupported : DirectTicketCaptureResult
}

/** Platform adapter. Android may use WebView; common code sees no platform types. */
fun interface DirectTicketCapture {
    suspend fun capture(service: UpstreamSessionService): DirectTicketCaptureResult
}

enum class SessionRecoveryOutcome {
    RECOVERED,
    INTERACTION_REQUIRED,
    SESSION_DEAD,
    AUTH_REJECTED,
    SESSION_CHANGED,
    CONFLICT,
    NETWORK_FAILURE,
    UPSTREAM_INVALID,
    UNSUPPORTED,
    PERSISTENCE_FAILURE,
}

/**
 * Coordinates one service renewal. The identity is used only as an in-memory
 * single-flight key; it is never passed to either adapter, persisted, or logged.
 * Capture and renewal have separate seams so tests can exercise their contract
 * without WebView, Ktor, or Compose.
 */
class SessionRecoveryCoordinator(
    private val capture: DirectTicketCapture,
    private val renewal: UpstreamSessionRenewal,
    private val tokenStore: TokenStoreLike,
    private val readCurrentStatus: suspend () -> Unit = {},
) {
    private data class FlightKey(
        val identity: String,
        val service: UpstreamSessionService,
    )

    private data class ActiveRecovery(
        val key: FlightKey,
        val claim: SessionFlight.Claim<SessionRecoveryOutcome>,
        val job: Job,
    )

    private val flights = SessionFlight<SessionRecoveryOutcome>()
    private val recoveryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val jobsMutex = Mutex()
    private val jobs = mutableMapOf<FlightKey, ActiveRecovery>()
    private var epoch = 0L
    private var clearing = false

    suspend fun recover(
        identity: String,
        service: UpstreamSessionService = UpstreamSessionService.KULON,
    ): SessionRecoveryOutcome {
        if (service != UpstreamSessionService.KULON) return SessionRecoveryOutcome.UNSUPPORTED
        if (identity.isBlank()) return SessionRecoveryOutcome.AUTH_REJECTED

        val key = FlightKey(identity, service)
        val claim = jobsMutex.withLock {
            if (clearing) return SessionRecoveryOutcome.SESSION_CHANGED

            val flight = flights.claim(key)
            if (!flight.isOwner) return@withLock flight

            val ownerEpoch = epoch
            // Register the lazy worker under the same lock used by clear(). A
            // logout can no longer slip between claim and job registration.
            val job = recoveryScope.launch(start = CoroutineStart.LAZY) {
                try {
                    val outcome = try {
                        recoverOwned(service, ownerEpoch)
                    } catch (e: CancellationException) {
                        flights.fail(flight, e)
                        throw e
                    } catch (_: Exception) {
                        SessionRecoveryOutcome.NETWORK_FAILURE
                    }
                    flights.release(flight, outcome)
                } finally {
                    val currentJob = currentCoroutineContext()[Job]
                    withContext(NonCancellable) {
                        jobsMutex.withLock {
                            if (jobs[key]?.job === currentJob) jobs.remove(key)
                        }
                    }
                }
            }
            jobs[key] = ActiveRecovery(key, flight, job)
            job.start()
            flight
        }
        return flights.join(claim)
    }

    /**
     * Explicit logout cancels capture/renewal and completes every waiter with
     * cancellation before the local credentials are cleared.
     */
    suspend fun clear() {
        val active = jobsMutex.withLock {
            clearing = true
            epoch += 1
            jobs.values.toList().also { runs ->
                jobs.clear()
                runs.forEach { it.job.cancel(CancellationException("Session recovery cleared")) }
            }
        }
        active.map { it.job }.joinAll()
        val cause = CancellationException("Session recovery cleared")
        active.forEach { flights.fail(it.claim, cause) }
        withContext(NonCancellable) {
            jobsMutex.withLock {
                active.forEach { run ->
                    if (jobs[run.key] === run) jobs.remove(run.key)
                }
            }
        }
    }

    /** Re-enable recovery only after a new login has durably replaced the JWT. */
    suspend fun resumeForNewSession() {
        jobsMutex.withLock {
            if (jobs.isNotEmpty()) return@withLock
            epoch += 1
            clearing = false
        }
    }

    private suspend fun recoverOwned(
        service: UpstreamSessionService,
        ownerEpoch: Long,
    ): SessionRecoveryOutcome {
        val captured = try {
            capture.capture(service)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return SessionRecoveryOutcome.NETWORK_FAILURE
        }

        val cookie = when (captured) {
            is DirectTicketCaptureResult.Authenticated -> captured.cookie
            DirectTicketCaptureResult.InteractionRequired -> return SessionRecoveryOutcome.INTERACTION_REQUIRED
            DirectTicketCaptureResult.NetworkFailure -> return SessionRecoveryOutcome.NETWORK_FAILURE
            DirectTicketCaptureResult.UpstreamInvalid -> return SessionRecoveryOutcome.UPSTREAM_INVALID
            DirectTicketCaptureResult.Unsupported -> return SessionRecoveryOutcome.UNSUPPORTED
        }
        if (cookie.isBlank()) return SessionRecoveryOutcome.UPSTREAM_INVALID

        val response = try {
            renewal.renewUpstreamSession(service, cookie)
        } catch (e: CancellationException) {
            throw e
        } catch (e: UpstreamSessionRenewalException) {
            if (e.failure == RenewalContractFailure.UPSTREAM_SESSION_CONFLICT) {
                return readStatusAfterConflict()
            }
            return e.failure.toRecoveryOutcome()
        } catch (_: Exception) {
            return SessionRecoveryOutcome.NETWORK_FAILURE
        }
        if (response.service != service || response.status != "renewed") {
            return SessionRecoveryOutcome.UPSTREAM_INVALID
        }

        return persistCookieIfCurrent(ownerEpoch, cookie)
    }

    /** Serialize the final credential write against explicit logout. */
    private suspend fun persistCookieIfCurrent(
        ownerEpoch: Long,
        cookie: String,
    ): SessionRecoveryOutcome = jobsMutex.withLock {
        if (clearing || epoch != ownerEpoch) return SessionRecoveryOutcome.SESSION_CHANGED
        try {
            when (tokenStore.updateKulonCookie(cookie)) {
                CookieUpdateResult.UPDATED -> SessionRecoveryOutcome.RECOVERED
                CookieUpdateResult.UNSUPPORTED -> SessionRecoveryOutcome.UNSUPPORTED
                CookieUpdateResult.FAILED -> SessionRecoveryOutcome.PERSISTENCE_FAILURE
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            SessionRecoveryOutcome.PERSISTENCE_FAILURE
        }
    }

    /** A CAS loser checks the latest server status once and never overwrites it. */
    private suspend fun readStatusAfterConflict(): SessionRecoveryOutcome = try {
        readCurrentStatus()
        SessionRecoveryOutcome.CONFLICT
    } catch (e: CancellationException) {
        throw e
    } catch (e: ApiHttpException) {
        if (e.status == 401 && e.code == BackendCodes.SESSION_DEAD) {
            SessionRecoveryOutcome.SESSION_DEAD
        } else {
            SessionRecoveryOutcome.NETWORK_FAILURE
        }
    } catch (_: Exception) {
        SessionRecoveryOutcome.NETWORK_FAILURE
    }

    private fun RenewalContractFailure.toRecoveryOutcome(): SessionRecoveryOutcome =
        when (this) {
            RenewalContractFailure.SESSION_DEAD -> SessionRecoveryOutcome.SESSION_DEAD
            RenewalContractFailure.AUTH_REJECTED -> SessionRecoveryOutcome.AUTH_REJECTED
            RenewalContractFailure.UPSTREAM_SESSION_INVALID -> SessionRecoveryOutcome.UPSTREAM_INVALID
            RenewalContractFailure.UPSTREAM_SESSION_CONFLICT -> SessionRecoveryOutcome.CONFLICT
            RenewalContractFailure.UPSTREAM_UNAVAILABLE,
            RenewalContractFailure.NETWORK_FAILURE,
            -> SessionRecoveryOutcome.NETWORK_FAILURE
            RenewalContractFailure.UNSUPPORTED -> SessionRecoveryOutcome.UNSUPPORTED
        }
}
