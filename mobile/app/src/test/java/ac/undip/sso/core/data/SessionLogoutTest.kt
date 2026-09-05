package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locks the F3 ordering + cancellation + single-flight semantics of
 * [SessionLogout] BEFORE the class exists (Task 2b implements to this batch):
 *  - pushUnregister runs FIRST (bearer still live) -> revokeServerSession
 *    SECOND (bearer still live) -> localCleanup ALWAYS, LAST.
 *  - localCleanup is NON-SUSPENDING (`() -> Unit`) and unconditional.
 *  - ordinary network/HTTP failures in the two server steps are best-effort
 *    (never throw; cleanup still runs) — INCLUDING a no-bearer attempt and an
 *    expired-token 401 from the unregister step.
 *  - CancellationException is rethrown AFTER localCleanup has run — from
 *    EITHER server step — and any waiting concurrent caller is released.
 *  - logout() is SINGLE-FLIGHT: a concurrent second invocation collapses into
 *    the running one (exactly one pushUnregister -> one revoke -> one
 *    cleanup), so no server call is ever fired after the first cleanup has
 *    nulled the shared token.
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
        // NON-SUSPENDING on purpose: the orchestrator contract requires a
        // `() -> Unit` cleanup (R2-1). A `suspend` lambda here is a compile
        // error, which is exactly the structural guarantee the production
        // signature provides.
        val localCleanup: () -> Unit = {
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

    // Fake of the wasmJs TokenStore contract: `clearImmediately()` is the
    // SYNCHRONOUS persisted-JWT removal (localStorage + flows reset) and the
    // suspending `clear()` delegates to it. Mirrors
    // TokenStore.wasmJs.kt — the production wasm glue must call
    // clearImmediately() INLINE in localCleanup, never schedule clear().
    private class FakeWasmStore(persisted: String? = "jwt-1") {
        var persisted: String? = persisted
        var uiState: String? = persisted // mirrors the _jwt StateFlow

        fun clearImmediately() {
            persisted = null
            uiState = null
        }

        suspend fun clear() = clearImmediately()
    }

    @Test
    fun `wasm-style glue removes persisted JWT synchronously before UI flips`() = runTest {
        // Locks finding-1 production shape (AppRoot.wasmJs localCleanup):
        // persisted-JWT removal is a SYNCHRONOUS inline call that has
        // completed when logout() returns — never a scheduled async clear
        // that the logged-out UI could outrun. History clear stays scheduled
        // best-effort. No scheduler advancement is needed below: everything
        // asserted must already hold the moment logout() returns.
        val store = FakeWasmStore()
        var historyClearScheduled = false
        var uiLoggedOut = false
        val logout =
            SessionLogout(
                revokeServerSession = {},
                pushUnregister = {},
                localCleanup = {
                    historyClearScheduled = true
                    backgroundScope.launch { /* history.clear() best-effort */ }
                    // REQUIRED production wasm shape: synchronous inline
                    // removal — the UI flip below cannot outrun it.
                    store.clearImmediately()
                    uiLoggedOut = true
                },
            )
        logout.logout()
        assertNull("persisted JWT must be gone when logout() returns", store.persisted)
        assertNull(store.uiState)
        assertTrue(uiLoggedOut)
        assertTrue(historyClearScheduled)
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
    fun `stale release never erases a newer deferred`() = runTest {
        // Regression for the single-flight release race: creator A completes
        // its deferred and then clears `inflight`; if creator B claimed a NEW
        // deferred in between, A's stale release must leave B's deferred in
        // place (otherwise a third caller would miss B's run and start a
        // duplicate unauthenticated sequence). Drives the REAL release path
        // (the same function the nested finally calls) with a forged stale
        // deferred — fully deterministic, no timing involved.
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        var runs = 0
        val logout =
            SessionLogout(
                revokeServerSession = { runs++ },
                pushUnregister = {
                    firstEntered.complete(Unit)
                    releaseFirst.await() // hold the creator mid-sequence
                },
                localCleanup = {},
            )
        val first = async { logout.logout() } // creator, parks in pushUnregister
        firstEntered.await()
        val stale = CompletableDeferred<Unit>() // forged: never was `inflight`
        logout.releaseIfCurrent(stale) // must be a field no-op…
        // …so a waiter arriving right after still JOINS the parked creator
        // instead of becoming a second creator (a naive unconditional
        // `inflight = null` would orphan the creator's deferred here and this
        // waiter would re-run the whole sequence → runs == 2).
        val waiter = async { logout.logout() }
        yield() // let the waiter reach the claim and suspend
        releaseFirst.complete(Unit)
        first.await()
        waiter.await()
        assertEquals(1, runs)
        // The instance accepts a fresh run afterwards (the field holds no
        // orphaned stale-or-newer deferred in either direction).
        logout.logout()
        assertEquals(2, runs)
    }

    @Test(timeout = 60_000)
    fun `burst of concurrent logouts on real threads runs exactly one sequence`() {
        // Concrete JVM concurrency coverage (Dispatchers.Default, real thread
        // pool — NOT runTest virtual time): RACERS coroutines hammer one
        // shared instance; the creator parks in pushUnregister until every
        // racer has STARTED logout(), so all must collapse into its single
        // unregister -> revoke -> cleanup run. No duplicate server calls, no
        // stranded waiter, max overlap of server work is 1.
        val racers = 32
        val started = AtomicInteger(0)
        val unregisterCount = AtomicInteger(0)
        val revokeCount = AtomicInteger(0)
        val cleanupCount = AtomicInteger(0)
        val concurrent = AtomicInteger(0)
        val maxConcurrent = AtomicInteger(0)
        val logout =
            SessionLogout(
                revokeServerSession = {
                    revokeCount.incrementAndGet()
                    delay(5)
                },
                pushUnregister = {
                    while (started.get() < racers) delay(1)
                    val c = concurrent.incrementAndGet()
                    maxConcurrent.updateAndGet { m -> maxOf(m, c) }
                    try {
                        delay(5)
                        unregisterCount.incrementAndGet()
                    } finally {
                        concurrent.decrementAndGet()
                    }
                },
                localCleanup = { cleanupCount.incrementAndGet() },
            )
        runBlocking(Dispatchers.Default) {
            List(racers) { async { started.incrementAndGet(); logout.logout() } }
                .forEach { it.await() }
        }
        assertEquals(1, unregisterCount.get())
        assertEquals(1, revokeCount.get())
        assertEquals(1, cleanupCount.get())
        assertEquals(1, maxConcurrent.get())
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
