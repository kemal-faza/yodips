package ac.undip.sso.core.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * One identity + generation keyed single-flight primitive shared by every
 * mobile session coordinator (ADR-0003: use kotlinx `Mutex` everywhere).
 *
 * Five coordinators used to re-implement "generation/identity-guarded
 * single-flight" with divergent primitives — a raw [CompletableDeferred] with
 * no lock ([SessionRefresher]), a `Set` guarded by `platformSynchronized`
 * ([CacheCoordinator]), a Mutex + generation field ([PushTokenCoordinator]),
 * and a global counter ([ac.undip.sso.core.network.SessionExpiredEvents]).
 * This class owns that race policy once:
 *
 *  - one suspending [Mutex] — identical on JVM and wasm (never a no-op),
 *  - one [CompletableDeferred] per identity to collapse duplicate work,
 *  - release completes waiters FIRST and clears the entry only if it is still
 *    ours, so a stale owner can never erase a newer flight,
 *  - the conditional clear runs under [NonCancellable], so a cancelled owner
 *    still unblocks every waiter.
 *
 * Claim/join/release is suspend-based because the lock is a kotlinx Mutex;
 * every caller already runs inside a coroutine scope (see ADR-0003).
 */
internal class SessionFlight<T> {
    private class Flight<T>(
        val generation: Long,
        val deferred: CompletableDeferred<T>,
    )

    /** A claimed or joined flight. Only an owner may [release]. */
    class Claim<T> internal constructor(
        internal val identity: Any,
        val generation: Long,
        internal val deferred: CompletableDeferred<T>,
        val isOwner: Boolean,
    )

    private val mutex = Mutex()
    private val flights = mutableMapOf<Any, Flight<T>>()

    /**
     * Claim-or-join the flight for [identity] at [generation]. The first caller
     * owns a fresh flight; a concurrent caller with the SAME identity and
     * generation joins it. A different generation supersedes: the caller owns a
     * new flight, while the previous flight stays valid for its own waiters.
     */
    suspend fun claim(identity: Any, generation: Long = 0L): Claim<T> =
        mutex.withLock {
            val existing = flights[identity]
            if (existing != null && existing.generation == generation && !existing.deferred.isCompleted) {
                Claim(identity, generation, existing.deferred, isOwner = false)
            } else {
                val deferred = CompletableDeferred<T>()
                flights[identity] = Flight(generation, deferred)
                Claim(identity, generation, deferred, isOwner = true)
            }
        }

    /**
     * Claim-only: returns null when a flight for [identity] at [generation] is
     * already running. Used where a duplicate run is SKIPPED rather than joined
     * (the cache's stale-while-revalidate background refresh).
     */
    suspend fun claimOrNull(identity: Any, generation: Long = 0L): Claim<T>? =
        mutex.withLock {
            val existing = flights[identity]
            if (existing != null && existing.generation == generation && !existing.deferred.isCompleted) {
                null
            } else {
                val deferred = CompletableDeferred<T>()
                flights[identity] = Flight(generation, deferred)
                Claim(identity, generation, deferred, isOwner = true)
            }
        }

    /** Await the shared outcome (works for owners and joiners). */
    suspend fun join(claim: Claim<T>): T = claim.deferred.await()

    /**
     * Publish [value] to every waiter and clear the flight iff it is still
     * ours. Completion is non-suspending and happens FIRST, so a cancelled
     * owner still releases its waiters; the conditional clear is
     * [NonCancellable] so it cannot be cancelled away mid-release.
     */
    suspend fun release(claim: Claim<T>, value: T) {
        claim.deferred.complete(value)
        clearIfCurrent(claim)
    }

    /** Fail every waiter with [error], then clear iff still ours. */
    suspend fun fail(claim: Claim<T>, error: Throwable) {
        claim.deferred.completeExceptionally(error)
        clearIfCurrent(claim)
    }

    private suspend fun clearIfCurrent(claim: Claim<T>) {
        withContext(NonCancellable) {
            mutex.withLock {
                val current = flights[claim.identity]
                if (current != null && current.deferred === claim.deferred) {
                    flights.remove(claim.identity)
                }
            }
        }
    }

    /** Observable seam for tests: the tracked flight for [identity], if any. */
    internal suspend fun currentForTest(identity: Any): Claim<T>? =
        mutex.withLock {
            flights[identity]?.let { Claim(identity, it.generation, it.deferred, isOwner = true) }
        }
}

/**
 * Exclusive transition lock built on the same primitive: a caller that arrives
 * while [identity] is held joins the running owner, then re-claims, so the work
 * is serialised. Used by [ac.undip.sso.core.push.PushTokenCoordinator], whose
 * login/rotation/logout transitions must not interleave.
 */
internal suspend fun <R> SessionFlight<Unit>.lock(
    identity: Any,
    block: suspend () -> R,
): R {
    while (true) {
        val claim = claim(identity)
        if (claim.isOwner) {
            return try {
                block()
            } finally {
                release(claim, Unit)
            }
        }
        join(claim)
    }
}
