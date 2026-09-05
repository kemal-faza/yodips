package ac.undip.sso.core.push

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the token/logout lifecycle contract through the REAL production
 * [PushTokenCoordinator] — one fresh constructible instance per test via
 * normal DI (a pure fake [PushRegistration.Ops]), so suites isolate state
 * with no companion-singleton contamination and no reflection:
 *  - onLogin registers the FCM token and tracks it as active;
 *  - onNewToken tracks only when logged in (otherwise stashes pending);
 *  - onLogout unregisters the active token and ALWAYS clears it in a
 *    `finally` — success, ordinary backend `false`, unexpected throw
 *    (propagates), or [CancellationException] (rethrows AND clears);
 *  - onLogout without an active token is a no-op;
 *  - two coordinators never share state.
 *
 * [PushGraph] is thin production wiring over this class (same behavior,
 * app-scope singleton); it is never mutated by tests.
 */
class PushTokenCoordinatorTest {
    private class FakeOps(
        var unregister: suspend (String) -> Boolean = { true },
        var register: suspend (String) -> Boolean = { true },
    ) : PushRegistration.Ops {
        val unregistered = mutableListOf<String>()
        val stashed = mutableListOf<String>()
        var pending: String? = null
        override suspend fun currentFcmToken(): String? = "fcm-fresh"
        override suspend fun registerOnBackend(token: String): Boolean = register(token)
        override suspend fun unregisterOnBackend(token: String): Boolean {
            unregistered += token
            return unregister(token)
        }
        override suspend fun stashPending(token: String) {
            stashed += token
            pending = token
        }
        override suspend fun readPending(): String? = pending
        override suspend fun clearPending() {
            pending = null
        }
    }

    private fun coordinator(ops: FakeOps = FakeOps()) = PushTokenCoordinator(PushRegistration(ops))

    @Test
    fun `onLogin registers fresh token and tracks it active`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        val token = coordinator.onLogin()
        assertEquals("fcm-fresh", token)
        assertEquals("fcm-fresh", coordinator.activeToken)
    }

    @Test
    fun `onLogin consumes pending token first`() = runTest {
        val ops = FakeOps().apply { pending = "fcm-pending" }
        val coordinator = coordinator(ops)
        assertEquals("fcm-pending", coordinator.onLogin())
        assertEquals("fcm-pending", coordinator.activeToken)
        assertNull(ops.pending)
    }

    @Test
    fun `onNewToken while logged in tracks the rotated token`() = runTest {
        val coordinator = coordinator()
        coordinator.onNewToken("fcm-rotated", loggedIn = true)
        assertEquals("fcm-rotated", coordinator.activeToken)
    }

    @Test
    fun `onNewToken while logged out stashes and tracks nothing`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-rotated", loggedIn = false)
        assertEquals(listOf("fcm-rotated"), ops.stashed)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout unregisters active token and clears it`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-1", loggedIn = true)
        coordinator.onLogout()
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout clears activeToken when unregister reports ordinary failure`() = runTest {
        val ops = FakeOps(unregister = { false })
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-1", loggedIn = true)
        coordinator.onLogout() // ordinary failure: no throw, token still cleared
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout clears activeToken even on unexpected throw`() = runTest {
        val ops = FakeOps(unregister = { throw IllegalStateException("boom") })
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-1", loggedIn = true)
        try {
            coordinator.onLogout()
            fail("expected IllegalStateException")
        } catch (expected: IllegalStateException) {
            // propagates…
        }
        // …but the token is never retained.
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout rethrows cancellation and still clears activeToken`() = runTest {
        val ops = FakeOps(unregister = { throw CancellationException("cancelled") })
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-1", loggedIn = true)
        try {
            coordinator.onLogout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // must propagate to the SessionLogout orchestrator…
        }
        // …but must never retain the token (cancellation cannot keep state).
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout with ordinary IOException mapped to false still clears`() = runTest {
        // Mirrors the production Ops (backendUnregisterCatching): an offline
        // backend surfaces as `false`, never as a throw.
        val ops = FakeOps(unregister = { backendUnregisterCatching { throw IOException("offline") } })
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-1", loggedIn = true)
        coordinator.onLogout()
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout without active token is a no-op`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        coordinator.onLogout()
        assertTrue(ops.unregistered.isEmpty())
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `coordinators never share state`() = runTest {
        val first = coordinator()
        val second = coordinator()
        assertNotSame(first, second)
        first.onNewToken("fcm-first", loggedIn = true)
        assertEquals("fcm-first", first.activeToken)
        assertNull("fresh instance starts with no active token", second.activeToken)
        first.onLogout()
        assertNull(first.activeToken)
        assertNull(second.activeToken)
    }
}
