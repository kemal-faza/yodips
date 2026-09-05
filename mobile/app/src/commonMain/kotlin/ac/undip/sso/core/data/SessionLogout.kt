package ac.undip.sso.core.data

import kotlinx.coroutines.CancellationException

/**
 * Server-session logout orchestrator with guaranteed local cleanup.
 *
 * Pure + dependency-free (mirrors the [PushRegistration] minimal-ops
 * precedent): the three steps are injected as lambdas, so this class is
 * JVM-testable without any platform/network/Compose dependency and carries no
 * DI framework or expect/actual.
 *
 * ORDERING (F3 fix): [pushUnregister] runs FIRST while the bearer + server
 * session are still live — the device-registry DELETE routes are
 * session-presence-checked, so an unregister sent after the server logout
 * (record cleared) would 401 and leave a stale device row. Then
 * [revokeServerSession] (still bearer-authenticated). Local cleanup
 * ([localCleanup]) ALWAYS runs LAST and is NON-SUSPENDING — its type is
 * `() -> Unit`, which STRUCTURALLY prohibits any suspension inside it at
 * compile time — so token nulling / store clearing never precedes the two
 * authenticated server calls and no suspension point can be cancelled
 * mid-cleanup.
 *
 * CONCURRENT/DOUBLE LOGOUT: [logout] is SINGLE-FLIGHT. The first (creator)
 * caller runs the whole unregister → revoke → cleanup sequence; a concurrent
 * second caller does NOT start a second sequence (which, once the first
 * cleanup has nulled the shared token, would fire its server calls
 * unauthenticated) — it awaits the creator's shared [CompletableDeferred] and
 * returns when that invocation has finished. The creator releases waiters in
 * a NESTED `finally` AFTER [localCleanup] on EVERY exit path (normal return,
 * [CancellationException] rethrow, OR a cleanup throw), so no waiter is ever
 * stranded and a cancelled first logout still completes cleanup and unblocks
 * any waiter; a later logout then runs a fresh, fully authenticated sequence.
 * This mirrors the single-flight refresh pattern already used by
 * [SessionRefresher] (same codebase precedent).
 *
 * The shared gate needs no lock beyond its own [platformSynchronized]
 * sections (real JVM monitor on Android/unit tests; a no-op on wasmJs,
 * which is single-threaded): the claim-or-join happens in one
 * non-suspending atomic section, and the release happens inside the
 * creator's non-suspending nested `finally` via
 * [SingleFlightGate.releaseIfCurrent]. `CompletableDeferred.complete` is
 * thread-safe and idempotent.
 *
 * RELEASE IDENTITY: the creator completes its deferred FIRST (releasing
 * waiters) and then clears the field ONLY if it still holds the creator's
 * own deferred (`inflight === creatorDeferred`). A newer creator that
 * claimed a fresh deferred in between (it saw a completed deferred, which
 * does not count as in-flight) is never erased — otherwise a third caller
 * would miss the newer run and start a duplicate, post-cleanup
 * (unauthenticated) sequence. The complete-then-conditional-clear pair is
 * non-suspending, so no cancellation can interleave inside it.
 *
 * FAILURE POLICY: ordinary network/HTTP failures (offline, 5xx, 401, timeout,
 * including a no-bearer attempt) in the two server steps are best-effort —
 * swallowed, never thrown to the UI, cleanup always proceeds. Structured
 * cancellation is NOT swallowed: a [CancellationException] from EITHER step
 * propagates to the CREATOR's caller AFTER [localCleanup] and the waiter
 * release have both run (the rethrow happens outside the nested `finally`);
 * waiting callers observe the completed (cleanup-done) state and return
 * normally. If [localCleanup] itself throws, that exception supersedes any
 * pending one (Kotlin `finally` semantics) but the nested `finally` STILL
 * releases waiters first. Never wrap the steps in `runCatching` (it would
 * swallow CancellationException).
 */
class SessionLogout(
    private val revokeServerSession: suspend () -> Unit,
    private val pushUnregister: suspend () -> Unit,
    private val localCleanup: () -> Unit,
) {
    private val gate = SingleFlightGate()

    suspend fun logout() {
        // Claim-or-join the single in-flight run at the SingleFlightGate
        // boundary (one non-suspending critical section — the server steps
        // below run OUTSIDE it). A deferred that is already COMPLETED does
        // not count as in-flight (the creator finished and its
        // non-suspending release may not have cleared the field yet): the
        // next caller becomes a fresh creator and runs a new sequence.
        val (deferred, isCreator) = gate.claimOrJoin()
        if (!isCreator) {
            deferred.await() // collapse: wait for the running logout, do not re-run
            return
        }
        try {
            try {
                pushUnregister() // DELETE device/web-device — bearer must still be live
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // best-effort — the unregister is a best-attempt prune
            }
            try {
                revokeServerSession() // POST /api/auth/logout — bearer still live
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // offline / 5xx / 401 / timeout / no bearer — best-effort
            }
        } finally {
            // NESTED finally: localCleanup runs first, then waiters are
            // released EVEN IF cleanup itself throws (R2-2) — no stranded
            // Deferred on any path. Nothing here suspends: the creator may
            // already be in the cancelling state when a CancellationException
            // is rethrown, and a suspension point here would throw
            // CancellationException again and skip the release. `complete` is
            // thread-safe/idempotent and the field clear is non-suspending.
            try {
                localCleanup() // non-suspending: token nulled, stores/cookies cleared
            } finally {
                gate.releaseIfCurrent(deferred) // complete waiters, clear field iff ours
            }
        }
    }
}
