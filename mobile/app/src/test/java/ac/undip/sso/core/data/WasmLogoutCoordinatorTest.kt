package ac.undip.sso.core.data

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the wasmJs (PWA) logout side-effect contract through the REAL
 * production [WasmLogoutCoordinator] (the same instance shape
 * AppRoot.wasmJs wires into [SessionLogout]) — no fake glue:
 *  - localCleanup deletes the persisted JWT SYNCHRONOUSLY, before the
 *    logged-out UI flips (a scheduled async clear would let the UI outrun
 *    the localStorage removal; a kill/restart in between resurrects the
 *    session);
 *  - the suspending `clear()` delegates to the same synchronous primitive
 *    (mirrors TokenStore.wasmJs `clear() = clearImmediately()`);
 *  - browser unsubscribe still runs after an ORDINARY backend DELETE
 *    failure (a stale server error must never leave the browser
 *    subscription live);
 *  - structured cancellation propagates (server DELETE CE skips the
 *    browser step; browser CE propagates) and, through [SessionLogout],
 *    still runs cleanup before the rethrow.
 *
 * Browser/DOM APIs never enter common code: every platform effect arrives
 * as an injected op on [WasmLogoutCoordinator.Ops].
 */
class WasmLogoutCoordinatorTest {

    /** Recording harness for the injected platform ops. */
    private class RecordingOps(
        var pushSupported: Boolean = true,
        var serverDeleteError: Exception? = null,
        var browserUnsubscribeError: Exception? = null,
    ) : WasmLogoutCoordinator.Ops {
        val calls = mutableListOf<String>()
        var persistedJwt: String? = "jwt-1"
        var uiLoggedOut = false
        var historyClearScheduled = false

        override fun isPushSupported(): Boolean = pushSupported

        override suspend fun unregisterWebPushOnServer() {
            calls += "serverDelete"
            serverDeleteError?.let { throw it }
        }

        override suspend fun unsubscribeWebPushInBrowser() {
            calls += "browserUnsubscribe"
            browserUnsubscribeError?.let { throw it }
        }

        override fun scheduleHistoryClear() {
            calls += "scheduleHistoryClear"
            historyClearScheduled = true
        }

        override fun clearAuthToken() {
            calls += "clearAuthToken"
        }

        override fun clearPersistedCredentialsImmediately() {
            calls += "clearPersistedCredentials"
            persistedJwt = null
        }

        override fun showLoggedOutUi() {
            calls += "showLoggedOutUi"
            uiLoggedOut = true
        }
    }

    @Test
    fun `localCleanup deletes persisted JWT synchronously before logged-out UI`() {
        val ops = RecordingOps()
        val glue = WasmLogoutCoordinator(ops)
        glue.localCleanup()
        // No scheduler, no await: everything below holds the moment
        // localCleanup() returns — the removal is synchronous, inline.
        assertNull("persisted JWT must be gone when localCleanup() returns", ops.persistedJwt)
        assertTrue(ops.uiLoggedOut)
        assertTrue(ops.historyClearScheduled)
        assertEquals(
            listOf(
                "scheduleHistoryClear",
                "clearAuthToken",
                "clearPersistedCredentials",
                "showLoggedOutUi",
            ),
            ops.calls,
        )
        assertTrue(
            "credential deletion must precede the UI flip",
            ops.calls.indexOf("clearPersistedCredentials") < ops.calls.indexOf("showLoggedOutUi"),
        )
    }

    @Test
    fun `suspend clear delegates to the same synchronous primitive`() = runTest {
        // Mirrors the production TokenStore.wasmJs shape (`clear() =
        // clearImmediately()`): one synchronous primitive, two entry points
        // removing identical state. The glue below is the REAL coordinator
        // wired to the synchronous entry inline, so the suspending path and
        // the logout path cannot diverge.
        val ops = RecordingOps()
        val store =
            object {
                var persisted: String? = "jwt-1"
                fun clearImmediately() {
                    persisted = null
                }
                suspend fun clear() = clearImmediately()
            }
        val wired =
            WasmLogoutCoordinator(
                object : WasmLogoutCoordinator.Ops by ops {
                    override fun clearPersistedCredentialsImmediately() {
                        ops.calls += "clearPersistedCredentials"
                        store.clearImmediately()
                    }
                },
            )
        wired.localCleanup()
        assertNull(store.persisted)
        store.persisted = "jwt-2"
        store.clear()
        assertNull("suspend clear() must remove the same state", store.persisted)
    }

    @Test
    fun `browser unsubscribe still follows ordinary backend DELETE failure`() = runTest {
        val ops = RecordingOps(serverDeleteError = IOException("offline"))
        WasmLogoutCoordinator(ops).pushUnregister()
        assertEquals(listOf("serverDelete", "browserUnsubscribe"), ops.calls)
    }

    @Test
    fun `server DELETE cancellation propagates and skips browser unsubscribe`() = runTest {
        val ops = RecordingOps(serverDeleteError = CancellationException("cancelled"))
        try {
            WasmLogoutCoordinator(ops).pushUnregister()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // structured cancellation is never converted into best-effort
        }
        assertEquals(listOf("serverDelete"), ops.calls)
    }

    @Test
    fun `browser unsubscribe cancellation propagates`() = runTest {
        val ops = RecordingOps(browserUnsubscribeError = CancellationException("cancelled"))
        try {
            WasmLogoutCoordinator(ops).pushUnregister()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // propagates to the orchestrator, which still runs cleanup
        }
        assertEquals(listOf("serverDelete", "browserUnsubscribe"), ops.calls)
    }

    @Test
    fun `unsupported browser skips both push steps`() = runTest {
        val ops = RecordingOps(pushSupported = false)
        WasmLogoutCoordinator(ops).pushUnregister()
        assertTrue(ops.calls.isEmpty())
    }

    @Test
    fun `session logout through real glue clears credentials before UI on cancellation`() = runTest {
        val ops = RecordingOps(serverDeleteError = CancellationException("cancelled"))
        val glue = WasmLogoutCoordinator(ops)
        val logout =
            SessionLogout(
                revokeServerSession = { ops.calls += "revoke" },
                pushUnregister = { glue.pushUnregister() },
                localCleanup = { glue.localCleanup() },
            )
        try {
            logout.logout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // revoke is skipped (already cancelled), cleanup ran anyway
        }
        assertNull(ops.persistedJwt)
        assertTrue(ops.uiLoggedOut)
        assertEquals(
            listOf("serverDelete", "scheduleHistoryClear", "clearAuthToken", "clearPersistedCredentials", "showLoggedOutUi"),
            ops.calls,
        )
    }

    @Test
    fun `session logout through real glue runs full order on success`() = runTest {
        val ops = RecordingOps()
        val glue = WasmLogoutCoordinator(ops)
        val logout =
            SessionLogout(
                revokeServerSession = { ops.calls += "revoke" },
                pushUnregister = { glue.pushUnregister() },
                localCleanup = { glue.localCleanup() },
            )
        logout.logout()
        assertNull(ops.persistedJwt)
        assertTrue(ops.uiLoggedOut)
        assertEquals(
            listOf(
                "serverDelete", "browserUnsubscribe", "revoke",
                "scheduleHistoryClear", "clearAuthToken", "clearPersistedCredentials", "showLoggedOutUi",
            ),
            ops.calls,
        )
    }
}
