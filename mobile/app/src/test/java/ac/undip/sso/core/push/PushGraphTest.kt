package ac.undip.sso.core.push

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the pure backend-unregister wrapper used by the production
 * unregisterOnBackend Ops ([backendUnregisterCatching]):
 *  - ordinary network/HTTP failures map to `false` (best-effort prune —
 *    the [ac.undip.sso.core.data.SessionLogout] orchestrator continues to
 *    revoke + cleanup);
 *  - structured [CancellationException] is rethrown (never converted into
 *    a `false` "offline" result).
 *
 * The token/logout lifecycle itself is locked per-instance (no singleton,
 * no reflection) in [PushTokenCoordinatorTest]. [PushGraph]'s Android
 * collaborators (Context/DataStore/Firebase/Backend) are never touched
 * here.
 */
class PushGraphTest {
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
}
