package ac.undip.sso.core.push

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
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
 *  - onNewToken consults coordinator-owned active-session state (otherwise
 *    stashes pending);
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
        var current: String? = "fcm-fresh",
    ) : PushRegistration.Ops {
        val unregistered = mutableListOf<String>()
        val registered = mutableListOf<String>()
        val stashed = mutableListOf<String>()
        var pending: String? = null
        var clearPendingAction: suspend (String) -> Unit = { expectedToken ->
            if (pending == expectedToken) pending = null
        }
        override suspend fun currentFcmToken(): String? = current
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
        override suspend fun clearPending(expectedToken: String) = clearPendingAction(expectedToken)
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
    fun `successful registration makes fresh token pending before backend call`() = runTest {
        val ops = FakeOps(current = "fcm-fresh")
        var pendingAtRegistration: String? = null
        ops.register = {
            pendingAtRegistration = ops.pending
            true
        }

        assertEquals("fcm-fresh", coordinator(ops).onLogin())
        assertEquals("fcm-fresh", pendingAtRegistration)
    }

    @Test
    fun `successful rotation tracks active token before cancellable pending clear`() = runTest {
        val clearEntered = CompletableDeferred<Unit>()
        val releaseClear = CompletableDeferred<Unit>()
        val ops = FakeOps(current = "fcm-old")
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        ops.clearPendingAction = {
            clearEntered.complete(Unit)
            releaseClear.await()
            ops.pending = null
        }
        val rotation = async { coordinator.onNewToken("fcm-new") }

        clearEntered.await()
        assertEquals("fcm-new", coordinator.activeToken)
        rotation.cancel()
        releaseClear.complete(Unit)
        try {
            rotation.await()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // Cancellation is allowed to propagate only after finalization.
        }

        assertEquals("fcm-new", coordinator.activeToken)
        coordinator.onLogout()
        assertEquals(listOf("fcm-new"), ops.unregistered)
    }

    @Test
    fun `pending cleanup failure leaves successfully registered token active for logout`() = runTest {
        val ops =
            FakeOps().apply {
                pending = "fcm-new"
                clearPendingAction = { throw IOException("storage unavailable") }
            }
        val coordinator = coordinator(ops)

        try {
            coordinator.onLogin()
            fail("expected storage failure")
        } catch (expected: IOException) {
            // The backend registration succeeded before durable cleanup failed.
        }

        assertEquals("fcm-new", coordinator.activeToken)
        coordinator.onLogout()
        assertEquals(listOf("fcm-new"), ops.unregistered)
    }

    @Test
    fun `pending cleanup cannot erase a newer pending token`() = runTest {
        val ops =
            FakeOps().apply {
                pending = "fcm-new"
                register = {
                    pending = "fcm-newer"
                    true
                }
                clearPendingAction = { expectedToken ->
                    if (pending == expectedToken) pending = null
                }
            }
        val coordinator = coordinator(ops)

        assertEquals("fcm-new", coordinator.onLogin())
        assertEquals("fcm-new", coordinator.activeToken)
        assertEquals("fcm-newer", ops.pending)
    }

    @Test
    fun `onNewToken while active tracks the rotated token`() = runTest {
        val coordinator = coordinator()
        coordinator.onLogin()
        coordinator.onNewToken("fcm-rotated")
        assertEquals("fcm-rotated", coordinator.activeToken)
    }

    @Test
    fun `onNewToken while logged out stashes and tracks nothing`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        coordinator.onNewToken("fcm-rotated")
        assertEquals(listOf("fcm-rotated"), ops.stashed)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout unregisters active token and clears it`() = runTest {
        val ops = FakeOps()
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        coordinator.onLogout()
        assertEquals(listOf("fcm-fresh"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout clears activeToken when unregister reports ordinary failure`() = runTest {
        val ops = FakeOps(unregister = { false })
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        coordinator.onLogout() // ordinary failure: no throw, token still cleared
        assertEquals(listOf("fcm-fresh"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout clears activeToken even on unexpected throw`() = runTest {
        val ops = FakeOps(unregister = { throw IllegalStateException("boom") })
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        try {
            coordinator.onLogout()
            fail("expected IllegalStateException")
        } catch (expected: IllegalStateException) {
            // propagates…
        }
        // …but the token is never retained.
        assertEquals(listOf("fcm-fresh"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout rethrows cancellation and still clears activeToken`() = runTest {
        val ops = FakeOps(unregister = { throw CancellationException("cancelled") })
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        try {
            coordinator.onLogout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // must propagate to the SessionLogout orchestrator…
        }
        // …but must never retain the token (cancellation cannot keep state).
        assertEquals(listOf("fcm-fresh"), ops.unregistered)
        assertNull(coordinator.activeToken)
    }

    @Test
    fun `onLogout with ordinary IOException mapped to false still clears`() = runTest {
        // Mirrors the production Ops (backendUnregisterCatching): an offline
        // backend surfaces as `false`, never as a throw.
        val ops = FakeOps(unregister = { backendUnregisterCatching { throw IOException("offline") } })
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        coordinator.onLogout()
        assertEquals(listOf("fcm-fresh"), ops.unregistered)
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
    fun `rotation queued during logout is stashed for the next account`() = runTest {
        // HIGH race: a callback captured while logout is paused must not use
        // a stale bearer snapshot to register token B after token A is
        // unregistered. It must remain pending for the next account/login.
        val unregisterEntered = CompletableDeferred<Unit>()
        val releaseUnregister = CompletableDeferred<Unit>()
        val registered = mutableListOf<String>()
        val ops =
            FakeOps(
                current = "fcm-old",
                unregister = {
                    unregisterEntered.complete(Unit)
                    releaseUnregister.await() // logout holds the transition
                    true
                },
                register = {
                    registered += it
                    true
                },
            )
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        assertEquals("fcm-old", coordinator.activeToken)
        val logout = async { coordinator.onLogout() }
        unregisterEntered.await() // logout is inside unregister, lock held
        val rotated = async { coordinator.onNewToken("fcm-new") }
        yield() // let the rotation reach the transition lock and suspend
        yield()
        assertTrue(
            "rotation must wait for the paused logout, not register early",
            "fcm-new" !in registered,
        )
        assertEquals("fcm-old", coordinator.activeToken)
        releaseUnregister.complete(Unit)
        logout.await()
        rotated.await()
        // Logout unregistered exactly the old token and cleared; the queued
        // rotation was stashed rather than orphaning a backend registration.
        assertEquals(listOf("fcm-old"), ops.unregistered)
        assertEquals(listOf("fcm-old"), registered)
        assertEquals("fcm-new", ops.pending)
        assertNull(coordinator.activeToken)

        // Account switch: the pending device token is registered only by the
        // new login, never by the stale callback under the new bearer.
        assertEquals("fcm-new", coordinator.onLogin())
        assertEquals(listOf("fcm-old", "fcm-new"), registered)
        assertEquals("fcm-new", coordinator.activeToken)
    }

    @Test
    fun `concurrent onLogin waits for paused onLogout`() = runTest {
        // Same transition lock the other way: a login racing logout must not
        // register + track a token that the logout's finally then wipes.
        val unregisterEntered = CompletableDeferred<Unit>()
        val releaseUnregister = CompletableDeferred<Unit>()
        val registered = mutableListOf<String>()
        val ops =
            FakeOps(
                current = "fcm-old",
                unregister = {
                    unregisterEntered.complete(Unit)
                    releaseUnregister.await()
                    true
                },
                register = {
                    registered += it
                    true
                },
            )
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        val logout = async { coordinator.onLogout() }
        unregisterEntered.await()
        val login = async { coordinator.onLogin() }
        yield() // let the login reach the transition lock and suspend
        yield()
        assertTrue("login must wait for the paused logout", "fcm-fresh" !in registered)
        assertEquals("fcm-old", coordinator.activeToken)
        ops.current = "fcm-fresh"
        releaseUnregister.complete(Unit)
        logout.await()
        assertEquals("fcm-fresh", login.await())
        assertEquals(listOf("fcm-old", "fcm-fresh"), registered)
        assertEquals("fcm-fresh", coordinator.activeToken)
    }

    @Test
    fun `cancelled lock waiter propagates without touching backend or activeToken`() = runTest {
        // Cancellation while QUEUED on the transition lock must rethrow from
        // the waiter itself and leave backend + activeToken untouched.
        val unregisterEntered = CompletableDeferred<Unit>()
        val releaseUnregister = CompletableDeferred<Unit>()
        val registered = mutableListOf<String>()
        val ops =
            FakeOps(
                current = "fcm-old",
                unregister = {
                    unregisterEntered.complete(Unit)
                    releaseUnregister.await()
                    true
                },
                register = {
                    registered += it
                    true
                },
            )
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        val logout = async { coordinator.onLogout() }
        unregisterEntered.await()
        val waiter = async { coordinator.onNewToken("fcm-new") }
        yield() // let the waiter queue on the transition lock
        yield()
        waiter.cancel()
        try {
            waiter.await()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // waiter never acquired the lock — must propagate
        }
        releaseUnregister.complete(Unit)
        logout.await()
        assertTrue("cancelled waiter must never hit the backend", "fcm-new" !in registered)
        assertEquals(listOf("fcm-old"), registered)
        assertEquals(listOf("fcm-old"), ops.unregistered)
        assertNull("logout cleared the old token; nothing overwrote it", coordinator.activeToken)
    }

    @Test
    fun `onLogin rethrows cancellation and keeps fresh token pending for retry`() = runTest {
        val ops = FakeOps(current = "fcm-current")
        ops.register = { throw CancellationException("registration cancelled") }
        val coordinator = coordinator(ops)

        try {
            coordinator.onLogin()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // registration cancellation must reach the caller
        }

        assertEquals("fcm-current", ops.pending)
        assertNull(coordinator.activeToken)

        ops.register = { token -> ops.registered += token; true }
        assertEquals("fcm-current", coordinator.onLogin())
        assertEquals("fcm-current", coordinator.activeToken)
    }

    @Test
    fun `onNewToken rethrows cancellation and keeps prior active token recoverable`() = runTest {
        val ops = FakeOps(current = "fcm-old")
        val coordinator = coordinator(ops)
        coordinator.onLogin()
        ops.register = { throw CancellationException("rotation cancelled") }

        try {
            coordinator.onNewToken("fcm-new")
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // registration cancellation must reach the caller
        }

        assertEquals("fcm-old", coordinator.activeToken)
        assertEquals("fcm-new", ops.pending)

        ops.register = { token -> ops.registered += token; true }
        assertEquals("fcm-new", coordinator.onLogin())
        assertEquals("fcm-new", coordinator.activeToken)
    }

    @Test
    fun `coordinators never share state`() = runTest {
        val first = coordinator()
        val second = coordinator()
        assertNotSame(first, second)
        first.onLogin()
        first.onNewToken("fcm-first")
        assertEquals("fcm-first", first.activeToken)
        assertNull("fresh instance starts with no active token", second.activeToken)
        first.onLogout()
        assertNull(first.activeToken)
        assertNull(second.activeToken)
    }
}
