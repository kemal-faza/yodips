package ac.undip.sso.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Deterministic claim/join/release coordination at the shared single-flight
 * boundary [SessionLogout] and [SessionRefresher] delegate to ([SessionFlight]).
 * No sleeps, no thread pools, no scheduler assumptions: every interleaving
 * below is a plain sequential call, so the run is identical on every machine.
 */
class SessionFlightTest {
    private val id = "flight"

    @Test
    fun `first claim creates, concurrent claim joins while in-flight`() = runTest {
        val gate = SessionFlight<Unit>()
        val a = gate.claim(id)
        assertTrue(a.isOwner)
        val b = gate.claim(id)
        assertFalse("second claim joins the running deferred", b.isOwner)
        assertSame(a.deferred, b.deferred)
    }

    @Test
    fun `A completion then B fresh claim then A stale release cannot erase B`() = runTest {
        // The single-flight release race, driven through the REAL gate with a
        // GENUINE previous creator: A ran and completed (cleanup done) but its
        // non-suspending clear has not run yet; B observed the completed
        // deferred — which does not count as in-flight — and claimed a fresh
        // run; A's trailing release must leave B in place, or a third caller
        // would miss B and start a duplicate post-cleanup sequence.
        val gate = SessionFlight<Unit>()
        val a = gate.claim(id)
        assertTrue(a.isOwner)
        a.deferred.complete(Unit) // A finished; its clear has not run yet
        val b = gate.claim(id)
        assertTrue("completed deferred is not in-flight: B is a fresh creator", b.isOwner)
        assertTrue("B runs a new deferred, never A's", a.deferred !== b.deferred)
        gate.release(a, Unit) // A's stale release after B claimed
        assertSame("stale release must not erase the newer run", b.deferred, gate.currentForTest(id)?.deferred)
        val c = gate.claim(id)
        assertFalse("third caller joins B, never starts a duplicate", c.isOwner)
        assertSame(b.deferred, c.deferred)
        gate.release(b, Unit)
        assertNull(gate.currentForTest(id))
    }

    @Test
    fun `foreign release never clears the in-flight run`() = runTest {
        val gate = SessionFlight<Unit>()
        val a = gate.claim(id)
        val other = gate.claim("other")
        gate.release(other, Unit) // never was the `id` flight
        assertSame(a.deferred, gate.currentForTest(id)?.deferred)
        gate.release(a, Unit)
        assertNull(gate.currentForTest(id))
    }

    @Test
    fun `release completes waiters`() = runTest {
        val gate = SessionFlight<Unit>()
        val a = gate.claim(id)
        assertTrue(a.isOwner)
        val joinedSignal = CompletableDeferred<Unit>()
        val waiter = async {
            val b = gate.claim(id)
            assertFalse(b.isOwner)
            joinedSignal.complete(Unit)
            gate.join(b)
            "waiter-done"
        }
        joinedSignal.await()
        gate.release(a, Unit)
        assertEquals("waiter-done", waiter.await())
        assertNull(gate.currentForTest(id))
    }

    @Test
    fun `sequential creators each run fresh after release`() = runTest {
        val gate = SessionFlight<Unit>()
        val a = gate.claim(id)
        assertTrue(a.isOwner)
        gate.release(a, Unit)
        val b = gate.claim(id)
        assertTrue("no stale state survives a release", b.isOwner)
        assertNotSame(a.deferred, b.deferred)
        gate.release(b, Unit)
        assertNull(gate.currentForTest(id))
    }

    @Test
    fun `claimOrNull skips while in-flight and reopens after release`() = runTest {
        val gate = SessionFlight<Unit>()
        val a = gate.claimOrNull(id)
        assertTrue(a!!.isOwner)
        assertNull("a duplicate run is skipped, not joined", gate.claimOrNull(id))
        gate.release(a, Unit)
        val b = gate.claimOrNull(id)
        assertTrue("the key reopens once released", b!!.isOwner)
        gate.release(b, Unit)
    }

    @Test
    fun `a different generation supersedes without erasing the old waiters`() = runTest {
        val gate = SessionFlight<Unit>()
        val genOne = gate.claim(id, generation = 1L)
        assertTrue(genOne.isOwner)
        val genTwo = gate.claim(id, generation = 2L)
        assertTrue("a newer generation starts a fresh flight", genTwo.isOwner)
        assertNotSame(genOne.deferred, genTwo.deferred)
        gate.release(genOne, Unit) // stale release must not erase gen 2
        assertSame(genTwo.deferred, gate.currentForTest(id)?.deferred)
        gate.release(genTwo, Unit)
    }

    @Test
    fun `release reports the generation it was claimed with`() = runTest {
        val gate = SessionFlight<Unit>()
        val claim = gate.claim(id, generation = 7L)
        assertEquals(7L, claim.generation)
        gate.release(claim, Unit)
    }

    @Test
    fun `lock serialises concurrent callers until the owner releases`() = runTest {
        val gate = SessionFlight<Unit>()
        val order = mutableListOf<String>()
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val first = async {
            gate.lock(id) {
                order += "first-enter"
                firstEntered.complete(Unit)
                releaseFirst.await()
                order += "first-exit"
            }
        }
        firstEntered.await()
        val second = async { gate.lock(id) { order += "second-enter" } }
        yield()
        yield()
        assertEquals("second waits for the lock", listOf("first-enter"), order)
        releaseFirst.complete(Unit)
        first.await()
        second.await()
        assertEquals(listOf("first-enter", "first-exit", "second-enter"), order)
    }
}
