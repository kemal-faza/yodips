package ac.undip.sso.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Deterministic claim/join coordination at the ACTUAL single-flight
 * boundary [SessionLogout] delegates to ([SingleFlightGate]) — no sleeps,
 * no thread pools, no scheduler assumptions: every interleaving below is a
 * plain sequential call, so the run is identical on every machine:
 *  - first claim creates, second joins while in-flight;
 *  - A completion, B fresh claim, then A's stale release can NEVER erase B
 *    (a third caller still joins B — no duplicate post-cleanup sequence);
 *  - a foreign (never-in-flight) release is a field no-op;
 *  - release completes waiters and clears only its own claim.
 */
class SingleFlightGateTest {

    @Test
    fun `first claim creates, concurrent claim joins while in-flight`() {
        val gate = SingleFlightGate()
        val (a, aCreator) = gate.claimOrJoin()
        assertTrue(aCreator)
        val (b, bCreator) = gate.claimOrJoin()
        assertFalse("second claim joins the running deferred", bCreator)
        assertSame(a, b)
    }

    @Test
    fun `A completion then B fresh claim then A stale release cannot erase B`() {
        // The single-flight release race, driven through the REAL gate with
        // a GENUINE previous creator (not a forged deferred): A ran and
        // completed (cleanup done, waiters released); B observed the
        // completed deferred — which does not count as in-flight — and
        // claimed a fresh run; A's trailing release must leave B in place,
        // or a third caller would miss B and start a duplicate
        // post-cleanup (unauthenticated) sequence.
        val gate = SingleFlightGate()
        val (a, aCreator) = gate.claimOrJoin()
        assertTrue(aCreator)
        a.complete(Unit) // A finished; its release has not run yet
        val (b, bCreator) = gate.claimOrJoin()
        assertTrue("completed deferred is not in-flight: B is a fresh creator", bCreator)
        assertTrue("B runs a new deferred, never A's", a !== b)
        gate.releaseIfCurrent(a) // A's stale release after B claimed
        assertSame("stale release must not erase the newer run", b, gate.currentForTest())
        val (c, cCreator) = gate.claimOrJoin()
        assertFalse("third caller joins B, never starts a duplicate", cCreator)
        assertSame(b, c)
        gate.releaseIfCurrent(b)
        assertNull(gate.currentForTest())
    }

    @Test
    fun `foreign release never clears the in-flight run`() {
        val gate = SingleFlightGate()
        val (a, _) = gate.claimOrJoin()
        gate.releaseIfCurrent(CompletableDeferred()) // never was `inflight`
        assertSame(a, gate.currentForTest())
        gate.releaseIfCurrent(a)
        assertNull(gate.currentForTest())
    }

    @Test
    fun `release completes waiters`() = runTest {
        // Joiners observe the cleanup-done state and return normally: the
        // release completes the shared deferred (idempotent, thread-safe).
        val gate = SingleFlightGate()
        val (a, aCreator) = gate.claimOrJoin()
        assertTrue(aCreator)
        val joinedSignal = CompletableDeferred<Unit>()
        val waiter = async {
            val (joined, joiner) = gate.claimOrJoin()
            assertFalse(joiner)
            joinedSignal.complete(Unit) // joined A's deferred — release only after this
            joined.await()
            "waiter-done"
        }
        joinedSignal.await() // deterministic join handshake, no scheduler guess
        gate.releaseIfCurrent(a)
        assertEquals("waiter-done", waiter.await())
        assertNull(gate.currentForTest())
    }

    @Test
    fun `sequential creators each run fresh after release`() {
        val gate = SingleFlightGate()
        val (a, firstCreator) = gate.claimOrJoin()
        assertTrue(firstCreator)
        gate.releaseIfCurrent(a)
        val (b, secondCreator) = gate.claimOrJoin()
        assertTrue("no stale state survives a release", secondCreator)
        assertTrue(a !== b)
        gate.releaseIfCurrent(b)
        assertNull(gate.currentForTest())
    }
}
