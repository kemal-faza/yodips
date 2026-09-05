package ac.undip.sso.core.push

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the logout-path structured-concurrency contract of [PushGraph]:
 *  - the backend-unregister wrapper rethrows [CancellationException] (never
 *    converts cancellation into a `false` "offline" result) while ordinary
 *    failures still map to `false`;
 *  - [PushGraph.onLogout] clears `activeToken` in a `finally`, so a
 *    cancellation (or any throw) from the unregister can neither retain the
 *    token nor strand the logout.
 *
 * PushGraph's Android collaborators (Context/DataStore/Firebase/Backend) are
 * never touched here: `registration` + `activeToken` are seeded via
 * reflection with a pure fake [PushRegistration.Ops], keeping this a JVM
 * unit test with no overabstracted seam in production.
 */
class PushGraphTest {
    private class FakeOps(
        var unregister: suspend (String) -> Boolean = { true },
    ) : PushRegistration.Ops {
        val unregistered = mutableListOf<String>()
        override suspend fun currentFcmToken(): String? = null
        override suspend fun registerOnBackend(token: String): Boolean = true
        override suspend fun unregisterOnBackend(token: String): Boolean {
            unregistered += token
            return unregister(token)
        }
        override suspend fun stashPending(token: String) = Unit
        override suspend fun readPending(): String? = null
        override suspend fun clearPending() = Unit
    }

    private val registrationField =
        PushGraph::class.java.getDeclaredField("registration").apply { isAccessible = true }
    private val activeTokenField =
        PushGraph::class.java.getDeclaredField("activeToken").apply { isAccessible = true }

    private fun seed(token: String?, ops: FakeOps): FakeOps {
        registrationField.set(PushGraph, PushRegistration(ops))
        activeTokenField.set(PushGraph, token)
        return ops
    }

    private fun activeToken(): String? = activeTokenField.get(PushGraph) as String?

    @After
    fun reset() {
        // Leave no fake behind for other suites (registration cannot be
        // un-lateinit'ed; a benign no-op fake is the closest to pristine).
        seed(null, FakeOps())
    }

    // ---- backendUnregisterCatching: the pure wrapper used by the
    // production unregisterOnBackend Ops -------------------------------

    @Test
    fun `unregister wrapper passes backend true through`() = runTest {
        assertTrue(backendUnregisterCatching { true })
    }

    @Test
    fun `unregister wrapper maps ordinary failure to false`() = runTest {
        assertFalse(backendUnregisterCatching { throw IOException("offline") })
    }

    @Test
    fun `unregister wrapper rethrows CancellationException`() = runTest {
        try {
            backendUnregisterCatching { throw CancellationException("cancelled") }
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // structured cancellation must propagate, never become `false`
        }
    }

    // ---- onLogout: activeToken cleared in finally ---------------------

    @Test
    fun `onLogout clears activeToken on success`() = runTest {
        val ops = seed("fcm-1", FakeOps())
        PushGraph.onLogout()
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(activeToken())
    }

    @Test
    fun `onLogout clears activeToken when unregister reports ordinary failure`() = runTest {
        // Mirrors the production Ops (backendUnregisterCatching): an offline
        // backend surfaces as `false`, never as a throw.
        val ops = seed("fcm-1", FakeOps(unregister = { false }))
        PushGraph.onLogout() // ordinary failure: no throw, token still cleared
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(activeToken())
    }

    @Test
    fun `onLogout clears activeToken even on unexpected throw`() = runTest {
        // The finally is general: ANY throw still clears the token (and
        // propagates — only the SessionLogout orchestrator decides what is
        // best-effort).
        val ops =
            seed("fcm-1", FakeOps(unregister = { throw IllegalStateException("boom") }))
        try {
            PushGraph.onLogout()
            fail("expected IllegalStateException")
        } catch (expected: IllegalStateException) {
            // propagates…
        }
        // …but the token is never retained.
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(activeToken())
    }

    @Test
    fun `onLogout rethrows cancellation and still clears activeToken`() = runTest {
        val ops =
            seed("fcm-1", FakeOps(unregister = { throw CancellationException("cancelled") }))
        try {
            PushGraph.onLogout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // must propagate to the SessionLogout orchestrator…
        }
        // …but must never retain the token (cancellation cannot keep state).
        assertEquals(listOf("fcm-1"), ops.unregistered)
        assertNull(activeToken())
    }

    @Test
    fun `onLogout without active token is a no-op`() = runTest {
        val ops = seed(null, FakeOps())
        PushGraph.onLogout()
        assertTrue(ops.unregistered.isEmpty())
        assertNull(activeToken())
    }
}
