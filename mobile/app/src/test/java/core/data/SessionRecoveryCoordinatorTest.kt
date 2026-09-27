package ac.undip.sso.core.data

import ac.undip.sso.core.network.RenewalContractFailure
import ac.undip.sso.core.network.UpstreamSessionRenewal
import ac.undip.sso.core.network.UpstreamSessionRenewalException
import ac.undip.sso.core.network.UpstreamSessionRenewalResponse
import ac.undip.sso.core.network.UpstreamSessionService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionRecoveryCoordinatorTest {
    private class FakeTokenStore : TokenStoreLike {
        private val _siap = MutableStateFlow<String?>("siap-old")
        private val _kulon = MutableStateFlow<String?>("kulon-old")
        var token: String? = "jwt-current"
        var updateResult = CookieUpdateResult.UPDATED
        var updateCalls = 0
        var beforeUpdate: suspend () -> Unit = {}

        override val siapCookie: Flow<String?> = _siap.asStateFlow()
        override val kulonCookie: Flow<String?> = _kulon.asStateFlow()

        override suspend fun save(token: String, siap: String?, kulon: String?) {
            this.token = token
            if (siap != null) _siap.value = siap
            if (kulon != null) _kulon.value = kulon
        }

        override suspend fun updateKulonCookie(cookie: String): CookieUpdateResult {
            updateCalls++
            beforeUpdate()
            if (updateResult == CookieUpdateResult.UPDATED) _kulon.value = cookie
            return updateResult
        }

        override suspend fun currentToken(): String? = token

        override suspend fun clear() {
            token = null
            _siap.value = null
            _kulon.value = null
        }
    }

    @Test
    fun `authenticated capture renews backend then atomically updates only local Kulon cookie`() = runTest {
        val store = FakeTokenStore()
        var capturedService: UpstreamSessionService? = null
        var renewedService: UpstreamSessionService? = null
        var renewedCookie: String? = null
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture { service ->
                capturedService = service
                DirectTicketCaptureResult.Authenticated("MoodleSession=new")
            },
            renewal = UpstreamSessionRenewal { service, cookie ->
                renewedService = service
                renewedCookie = cookie
                UpstreamSessionRenewalResponse(service, "renewed")
            },
            tokenStore = store,
        )

        val outcome = coordinator.recover(identity = "verified-subject", service = UpstreamSessionService.KULON)

        assertEquals(SessionRecoveryOutcome.RECOVERED, outcome)
        assertEquals(UpstreamSessionService.KULON, capturedService)
        assertEquals(UpstreamSessionService.KULON, renewedService)
        assertEquals("MoodleSession=new", renewedCookie)
        assertEquals("jwt-current", store.currentToken())
        assertEquals("siap-old", store.siapCookie.first())
        assertEquals("MoodleSession=new", store.kulonCookie.first())
        assertEquals(1, store.updateCalls)
    }

    @Test
    fun `interaction required never sends a cookie to renewal or clears stored credentials`() = runTest {
        val store = FakeTokenStore()
        var renewalCalls = 0
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture { DirectTicketCaptureResult.InteractionRequired },
            renewal = UpstreamSessionRenewal { _, _ ->
                renewalCalls++
                error("renewal must not run after interaction is required")
            },
            tokenStore = store,
        )

        val outcome = coordinator.recover(identity = "verified-subject")

        assertEquals(SessionRecoveryOutcome.INTERACTION_REQUIRED, outcome)
        assertEquals(0, renewalCalls)
        assertEquals("jwt-current", store.currentToken())
        assertEquals("siap-old", store.siapCookie.first())
        assertEquals("kulon-old", store.kulonCookie.first())
        assertEquals(0, store.updateCalls)
    }

    @Test
    fun `contract failure codes become distinct recovery outcomes`() = runTest {
        val cases = listOf(
            RenewalContractFailure.SESSION_DEAD to SessionRecoveryOutcome.SESSION_DEAD,
            RenewalContractFailure.AUTH_REJECTED to SessionRecoveryOutcome.AUTH_REJECTED,
            RenewalContractFailure.UPSTREAM_SESSION_CONFLICT to SessionRecoveryOutcome.CONFLICT,
            RenewalContractFailure.UPSTREAM_SESSION_INVALID to SessionRecoveryOutcome.UPSTREAM_INVALID,
            RenewalContractFailure.UPSTREAM_UNAVAILABLE to SessionRecoveryOutcome.NETWORK_FAILURE,
            RenewalContractFailure.NETWORK_FAILURE to SessionRecoveryOutcome.NETWORK_FAILURE,
            RenewalContractFailure.UNSUPPORTED to SessionRecoveryOutcome.UNSUPPORTED,
        )

        for ((failure, expected) in cases) {
            val store = FakeTokenStore()
            var statusReads = 0
            val coordinator = SessionRecoveryCoordinator(
                capture = DirectTicketCapture {
                    DirectTicketCaptureResult.Authenticated("MoodleSession=new")
                },
                renewal = UpstreamSessionRenewal { _, _ ->
                    throw UpstreamSessionRenewalException(failure)
                },
                tokenStore = store,
                readCurrentStatus = { statusReads++ },
            )

            assertEquals(failure.name, expected, coordinator.recover(identity = "verified-subject"))
            assertEquals(failure.name, "kulon-old", store.kulonCookie.first())
            assertEquals(failure.name, 0, store.updateCalls)
            assertEquals(failure.name, if (failure == RenewalContractFailure.UPSTREAM_SESSION_CONFLICT) 1 else 0, statusReads)
        }
    }

    @Test
    fun `same identity and service share one capture and renewal flight`() = runTest {
        val store = FakeTokenStore()
        val captureStarted = CompletableDeferred<Unit>()
        val releaseCapture = CompletableDeferred<DirectTicketCaptureResult>()
        var captureCalls = 0
        var renewalCalls = 0
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                captureCalls++
                captureStarted.complete(Unit)
                releaseCapture.await()
            },
            renewal = UpstreamSessionRenewal { service, _ ->
                renewalCalls++
                UpstreamSessionRenewalResponse(service, "renewed")
            },
            tokenStore = store,
        )

        val first = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "verified-subject", service = UpstreamSessionService.KULON)
        }
        captureStarted.await()
        val second = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "verified-subject", service = UpstreamSessionService.KULON)
        }
        releaseCapture.complete(DirectTicketCaptureResult.Authenticated("MoodleSession=new"))

        assertEquals(SessionRecoveryOutcome.RECOVERED, first.await())
        assertEquals(SessionRecoveryOutcome.RECOVERED, second.await())
        assertEquals(1, captureCalls)
        assertEquals(1, renewalCalls)
        assertEquals(1, store.updateCalls)
    }

    @Test
    fun `different identities do not join each other's recovery flight`() = runTest {
        val store = FakeTokenStore()
        val capturesStarted = CompletableDeferred<Unit>()
        val releaseCapture = CompletableDeferred<DirectTicketCaptureResult>()
        var captureCalls = 0
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                captureCalls++
                if (captureCalls == 2) capturesStarted.complete(Unit)
                releaseCapture.await()
            },
            renewal = UpstreamSessionRenewal { service, _ -> UpstreamSessionRenewalResponse(service, "renewed") },
            tokenStore = store,
        )

        val first = async(start = CoroutineStart.UNDISPATCHED) { coordinator.recover(identity = "subject-A") }
        val second = async(start = CoroutineStart.UNDISPATCHED) { coordinator.recover(identity = "subject-B") }
        capturesStarted.await()
        releaseCapture.complete(DirectTicketCaptureResult.Authenticated("MoodleSession=new"))

        assertEquals(SessionRecoveryOutcome.RECOVERED, first.await())
        assertEquals(SessionRecoveryOutcome.RECOVERED, second.await())
        assertEquals(2, captureCalls)
    }

    @Test
    fun `cancelling one waiter does not cancel shared recovery`() = runTest {
        val store = FakeTokenStore()
        val captureStarted = CompletableDeferred<Unit>()
        val releaseCapture = CompletableDeferred<DirectTicketCaptureResult>()
        var captureCalls = 0
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                captureCalls++
                captureStarted.complete(Unit)
                releaseCapture.await()
            },
            renewal = UpstreamSessionRenewal { service, _ -> UpstreamSessionRenewalResponse(service, "renewed") },
            tokenStore = store,
        )

        val cancelled = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "same-session")
        }
        captureStarted.await()
        val remaining = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "same-session")
        }
        cancelled.cancelAndJoin()
        releaseCapture.complete(DirectTicketCaptureResult.Authenticated("MoodleSession=new"))

        assertEquals(SessionRecoveryOutcome.RECOVERED, remaining.await())
        assertEquals(1, captureCalls)
        assertEquals("MoodleSession=new", store.kulonCookie.first())
    }

    @Test
    fun `logout clears and cancels an active recovery flight`() = runTest {
        val store = FakeTokenStore()
        val captureStarted = CompletableDeferred<Unit>()
        val neverRelease = CompletableDeferred<DirectTicketCaptureResult>()
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                captureStarted.complete(Unit)
                neverRelease.await()
            },
            renewal = UpstreamSessionRenewal { service, _ -> UpstreamSessionRenewalResponse(service, "renewed") },
            tokenStore = store,
        )
        val waiting = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "same-session")
        }
        captureStarted.await()

        coordinator.clear()

        assertEquals(true, waiting.isCancelled)
        assertEquals("kulon-old", store.kulonCookie.first())
    }

    @Test
    fun `a new login reopens recovery after logout`() = runTest {
        val store = FakeTokenStore()
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                DirectTicketCaptureResult.Authenticated("MoodleSession=new")
            },
            renewal = UpstreamSessionRenewal { service, _ ->
                UpstreamSessionRenewalResponse(service, "renewed")
            },
            tokenStore = store,
        )

        coordinator.clear()
        coordinator.resumeForNewSession()

        assertEquals(SessionRecoveryOutcome.RECOVERED, coordinator.recover("new-generation"))
        assertEquals("MoodleSession=new", store.kulonCookie.first())
    }

    @Test
    fun `logout waits for an in-flight cookie write then clears it`() = runTest {
        val store = FakeTokenStore()
        val updateStarted = CompletableDeferred<Unit>()
        val releaseUpdate = CompletableDeferred<Unit>()
        store.beforeUpdate = {
            updateStarted.complete(Unit)
            releaseUpdate.await()
        }
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                DirectTicketCaptureResult.Authenticated("MoodleSession=new")
            },
            renewal = UpstreamSessionRenewal { service, _ ->
                UpstreamSessionRenewalResponse(service, "renewed")
            },
            tokenStore = store,
        )
        val recovery = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.recover(identity = "same-session")
        }
        updateStarted.await()

        val logout = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.clear()
            store.clear()
        }
        releaseUpdate.complete(Unit)
        logout.await()

        assertEquals(null, store.currentToken())
        assertEquals(null, store.kulonCookie.first())
        assertEquals(1, store.updateCalls)
        assertEquals(true, recovery.isCancelled || recovery.isCompleted)
    }

    @Test
    fun `unsupported service and unsupported local store do not claim recovery succeeded`() = runTest {
        val store = FakeTokenStore()
        var captureCalls = 0
        val coordinator = SessionRecoveryCoordinator(
            capture = DirectTicketCapture {
                captureCalls++
                DirectTicketCaptureResult.Authenticated("MoodleSession=new")
            },
            renewal = UpstreamSessionRenewal { service, _ -> UpstreamSessionRenewalResponse(service, "renewed") },
            tokenStore = store,
        )

        assertEquals(
            SessionRecoveryOutcome.UNSUPPORTED,
            coordinator.recover(identity = "verified-subject", service = UpstreamSessionService.SIAP),
        )
        assertEquals(0, captureCalls)

        store.updateResult = CookieUpdateResult.UNSUPPORTED
        assertEquals(SessionRecoveryOutcome.UNSUPPORTED, coordinator.recover(identity = "verified-subject"))
        assertEquals("kulon-old", store.kulonCookie.first())
    }
}
