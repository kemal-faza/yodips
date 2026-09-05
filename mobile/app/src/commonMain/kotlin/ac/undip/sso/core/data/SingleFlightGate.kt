package ac.undip.sso.core.data

import kotlinx.coroutines.CompletableDeferred

/**
 * Minimal single-flight claim/join/release primitive behind
 * [SessionLogout.logout] (same codebase precedent as [SessionRefresher]'s
 * refresh single-flight, but for non-suspending claim/release so the
 * creator's nested `finally` can never strand a waiter).
 *
 * PROTOCOL:
 *  - [claimOrJoin]: the first caller becomes the creator (runs the whole
 *    sequence); a concurrent second caller joins the running deferred and
 *    awaits it instead of starting a duplicate run (which, once the first
 *    cleanup has nulled the shared token, would fire its server calls
 *    unauthenticated). A deferred that is already COMPLETED does not count
 *    as in-flight (the creator finished and its non-suspending release may
 *    not have cleared the field yet): the next caller becomes a fresh
 *    creator and runs a new sequence.
 *  - [releaseIfCurrent]: completes the shared deferred FIRST (waiters
 *    observe the cleanup-done state and return normally), then clears the
 *    field ONLY if it still references the releaser's own deferred. A
 *    stale release — e.g. creator A whose `complete` already let successor
 *    B claim a fresh deferred — must never erase the newer run
 *    ([SingleFlightGateTest] pins this deterministically).
 *
 * The field needs no lock beyond [platformSynchronized]: it is only
 * read/written inside non-suspending atomic sections, and the
 * complete-then-conditional-clear pair is non-suspending, so no
 * cancellation can interleave inside it. `CompletableDeferred.complete`
 * is thread-safe and idempotent.
 */
internal class SingleFlightGate {
    private var inflight: CompletableDeferred<Unit>? = null
    private val lock = Any()

    /**
     * Claim-or-join the single in-flight run. Returns the shared deferred
     * plus whether the caller is the creator. Non-suspending throughout —
     * the server steps run OUTSIDE the critical section.
     */
    fun claimOrJoin(): Pair<CompletableDeferred<Unit>, Boolean> =
        platformSynchronized(lock) {
            val existing = inflight
            if (existing != null && !existing.isCompleted) existing to false
            else CompletableDeferred<Unit>().also { inflight = it } to true
        }

    /**
     * Creator release: complete waiters AFTER cleanup, then clear [inflight]
     * only if still ours. Non-suspending throughout, so it is safe inside
     * the creator's nested `finally` even while cancelling.
     */
    fun releaseIfCurrent(deferred: CompletableDeferred<Unit>) {
        deferred.complete(Unit) // release waiters AFTER cleanup; idempotent
        platformSynchronized(lock) { if (inflight === deferred) inflight = null }
    }

    /** Observable seam for tests: the currently tracked deferred, if any. */
    internal fun currentForTest(): CompletableDeferred<Unit>? =
        platformSynchronized(lock) { inflight }
}
