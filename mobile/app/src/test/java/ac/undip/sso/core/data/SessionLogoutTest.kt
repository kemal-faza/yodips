package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the F3 ordering + cancellation + single-flight semantics of
 * [SessionLogout] BEFORE the class exists (Task 2b implements to this batch):
 *  - pushUnregister runs FIRST (bearer still live) -> revokeServerSession
 *    SECOND (bearer still live) -> localCleanup ALWAYS, LAST.
 *  - localCleanup is SUSPENDING (`suspend () -> Unit`), unconditional, and
 *    executed under NonCancellable — a cancellation / Activity destruction
 *    mid-logout cannot leave the persisted JWT behind.
 *  - ordinary network/HTTP failures in the two server steps are best-effort
 *    (never throw; cleanup still runs) — INCLUDING a no-bearer attempt and an
 *    expired-token 401 from the unregister step.
 *  - CancellationException is rethrown AFTER localCleanup has run — from
 *    EITHER server step — and any waiting concurrent caller is released.
 *  - logout() is SINGLE-FLIGHT: a concurrent second invocation collapses into
 *    the running one (exactly one pushUnregister -> one revoke -> one
 *    cleanup), so no server call is ever fired after the first cleanup has
 *    nulled the shared token. The claim/join/release race itself (A
 *    completion, B fresh claim, A stale release cannot erase B) is pinned
 *    deterministically — no sleeps, no threads — at the actual boundary
 *    [SessionLogout] delegates to, in [SingleFlightGateTest].
 *  - the bearer is observed at EACH server step's own moment via a LOCAL
 *    mutable bearer variable — never the process-global Backend (purity).
 */
class SessionLogoutTest {

    // Shared spy: three step lambdas + fault injection. The bearer is a LOCAL
    // variable that the glue-parity cleanup lambda nulls (the ONLY nulling
    // site), exactly like AppRoot's localCleanup nulls Backend.authToken.
    private class Spy(var bearer: String? = "logout-jwt") {
        val calls = mutableListOf<String>()
        var unregisterError: Exception? = null
        var revokeError: Exception? = null

        val pushUnregister: suspend () -> Unit = {
            calls += "pushUnregister:${bearer != null}"
            unregisterError?.let { throw it }
        }
        val revokeServerSession: suspend () -> Unit = {
            calls += "revokeServerSession:${bearer != null}"
            revokeError?.let { throw it }
        }
        // DURABLE-CLEANUP (suspending) on purpose: the orchestrator contract
        // requires a `suspend () -> Unit` cleanup that is AWAITED inline under
        // NonCancellable — a fire-and-forget DataStore clear cancelled
        // mid-write would leave the persisted JWT behind.
        val localCleanup: suspend () -> Unit = {
            calls += "localCleanup"
            bearer = null // the ONLY nulling site — glue parity
        }
    }

    private fun assertFullOrder(s: Spy) {
        assertEquals(
            listOf("pushUnregister:true", "revokeServerSession:true", "localCleanup"),
            s.calls,
        )
    }

    @Test
    fun `order is pushUnregister then revokeServerSession then localCleanup`() = runTest {
        val s = Spy()
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `cleanup runs even when every step succeeds`() = runTest {
        val s = Spy()
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `unregister IOException is best-effort and revoke plus cleanup still run`() = runTest {
        val s = Spy().apply { unregisterError = IOException("offline") }
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `revoke IOException is best-effort and cleanup still runs`() = runTest {
        val s = Spy().apply { revokeError = IOException("offline") }
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `revoke 401 ApiHttpException is best-effort and cleanup still runs`() = runTest {
        val s = Spy().apply { revokeError = ApiHttpException(401, "SESSION_DEAD") }
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `no-bearer logout still attempts both server steps and cleanup completes`() = runTest {
        // Device whose token is already gone: each DELETE/revoke is attempted
        // anyway (the shared client sends an empty Bearer); an ordinary 401 is
        // best-effort; cleanup is deterministic. NO authenticated success is
        // invented — this asserts attempts + cleanup, nothing more (R2-7).
        val s = Spy(bearer = null)
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertEquals(
            listOf("pushUnregister:false", "revokeServerSession:false", "localCleanup"),
            s.calls,
        )
    }

    @Test
    fun `expired-token 401 from unregister never skips revoke or cleanup`() = runTest {
        // Backend contract §4.3: logout accepts an expired signed token on
        // generation match; the push unregister may 401 for an expired JWT
        // (best-effort) — revoke, browser unsubscribe, and cleanup continue.
        val s = Spy().apply { unregisterError = ApiHttpException(401, "expired") }
        SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup).logout()
        assertFullOrder(s)
    }

    @Test
    fun `cancellation during revoke runs cleanup then rethrows`() = runTest {
        val s = Spy().apply { revokeError = CancellationException("cancelled") }
        val logout = SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup)
        try {
            logout.logout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // expected — cleanup + waiter release ran BEFORE propagation
        }
        assertFullOrder(s)
        assertEquals(null, s.bearer)
    }

    @Test
    fun `cancellation during pushUnregister still runs cleanup then rethrows`() = runTest {
        val s = Spy().apply { unregisterError = CancellationException("cancelled") }
        val logout = SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup)
        try {
            logout.logout()
            fail("expected CancellationException")
        } catch (expected: CancellationException) {
            // expected — revoke is skipped (already cancelled), cleanup ran anyway
        }
        assertEquals(listOf("pushUnregister:true", "localCleanup"), s.calls)
        assertEquals(null, s.bearer)
    }

    @Test
    fun `cancellation mid-cleanup still completes durable clear and releases waiter`() = runTest {
        // HIGH durability: Activity destruction cancels the logout scope while
        // the SUSPENDING credential cleanup (a DataStore edit in production)
        // is in flight. The orchestrator runs cleanup under NonCancellable,
        // so the persisted JWT cannot survive; the waiter is still released
        // and observes the cleanup-done state. Deterministic: deferred gates,
        // no sleeps — through the REAL production SessionLogout seam.
        val cleanupEntered = CompletableDeferred<Unit>()
        val releaseCleanup = CompletableDeferred<Unit>()
        var durableCleared = false
        val logout =
            SessionLogout(
                revokeServerSession = {},
                pushUnregister = {},
                localCleanup = {
                    cleanupEntered.complete(Unit)
                    releaseCleanup.await() // suspending durable write in flight
                    durableCleared = true
                },
            )
        val first = async { runCatching { logout.logout() } }
        cleanupEntered.await() // creator is inside the suspending cleanup
        val waiter = async { logout.logout() } // joins the running deferred
        yield() // let the waiter reach the shared deferred and suspend
        first.cancel() // simulate Activity destruction cancelling the scope
        yield() // deliver the cancellation while cleanup is suspended
        assertFalse("cancelled cleanup must not be skipped", durableCleared)
        releaseCleanup.complete(Unit) // durable write finishes despite cancel
        runCatching { first.await() } // cancelled job: await rethrows CE — not asserted
        waiter.await() // waiter was released, never stranded
        assertTrue("cancelled logout must still complete durable credential cleanup", durableCleared)
    }

    @Test
    fun `double logout collapses into one sequence that never loses the bearer`() = runTest {
        val s = Spy()
        // Concurrency gate: holds the first pushUnregister until the second
        // invocation has also reached the single-flight check, then releases —
        // proving the second caller WAITS on the shared deferred and does not
        // start its own server calls after the first cleanup has run.
        val firstUnregisterEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val logout =
            SessionLogout(
                revokeServerSession = s.revokeServerSession,
                pushUnregister = {
                    s.calls += "pushUnregister:${s.bearer != null}"
                    if (s.calls.count { it.startsWith("pushUnregister:") } == 1) {
                        firstUnregisterEntered.complete(Unit)
                        releaseFirst.await() // first creator is mid-sequence
                    }
                },
                localCleanup = s.localCleanup,
            )
        val first = async { logout.logout() }
        firstUnregisterEntered.await() // first invocation is inside pushUnregister (creator)
        val second = async { logout.logout() } // must await the shared deferred, not re-run
        yield() // let the second caller reach the deferred and suspend
        assertTrue(
            "second caller waits, no second pushUnregister yet",
            s.calls.count { it.startsWith("pushUnregister:") } == 1,
        )
        releaseFirst.complete(Unit)
        first.await()
        second.await()
        // Single-flight: exactly ONE unregister -> ONE revoke -> ONE cleanup,
        // every server step with a live bearer, cleanup last, token nulled.
        assertFullOrder(s)
        assertEquals(null, s.bearer)
    }

    @Test
    fun `sequential logouts each run a fresh full sequence`() = runTest {
        // The creator's release clears its OWN deferred, so no stale state
        // survives: the next logout becomes a fresh creator and re-runs the
        // whole unregister -> revoke -> cleanup sequence.
        val s = Spy()
        val logout = SessionLogout(s.revokeServerSession, s.pushUnregister, s.localCleanup)
        logout.logout()
        // Second logout needs a live bearer again (fresh login in production).
        s.bearer = "logout-jwt-2"
        logout.logout()
        assertEquals(
            listOf(
                "pushUnregister:true", "revokeServerSession:true", "localCleanup",
                "pushUnregister:true", "revokeServerSession:true", "localCleanup",
            ),
            s.calls,
        )
    }

    @Test
    fun `cleanup throw still releases a waiting caller and propagates`() = runTest {
        // R2-2: waiters must NEVER be stranded — even when localCleanup itself
        // throws, the nested finally completes the shared deferred FIRST, so a
        // concurrent (waiting) caller returns normally; the cleanup exception
        // propagates to the CREATOR's caller.
        val s = Spy()
        val firstUnregisterEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        var cleanupThrows = false
        val logout =
            SessionLogout(
                revokeServerSession = s.revokeServerSession,
                pushUnregister = {
                    s.calls += "pushUnregister:${s.bearer != null}"
                    if (s.calls.count { it.startsWith("pushUnregister:") } == 1) {
                        firstUnregisterEntered.complete(Unit)
                        releaseFirst.await() // hold the creator mid-sequence
                    }
                },
                localCleanup = {
                    s.calls += "localCleanup"
                    if (cleanupThrows) throw IllegalStateException("cleanup boom")
                    s.bearer = null
                },
            )
        val first = async { runCatching { logout.logout() } }
        firstUnregisterEntered.await() // creator is inside pushUnregister
        cleanupThrows = true // arm BEFORE the waiter is released
        val second = async { runCatching { logout.logout() } } // must await the shared deferred
        yield() // let the second caller reach the deferred and suspend
        releaseFirst.complete(Unit)
        val firstResult = first.await().exceptionOrNull()
        val secondResult = second.await().exceptionOrNull()
        // Cleanup throw propagated to the creator; the waiter was released (its
        // deferred completed inside the nested finally) and observed NO error —
        // no stranded Deferred, no hang. Steps ran in order with a live bearer
        // until the cleanup itself threw.
        assertTrue("creator sees the cleanup exception", firstResult is IllegalStateException)
        assertEquals(null, secondResult)
        assertEquals(listOf("pushUnregister:true", "revokeServerSession:true", "localCleanup"), s.calls)
    }
}
