package ac.undip.sso.core.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

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
 * ([localCleanup]) ALWAYS runs LAST under [NonCancellable] — its type is
 * `suspend () -> Unit` and the orchestrator AWAITS it inline, so a
 * suspending credential write (the Android DataStore edit) that is
 * cancelled mid-flight by Activity destruction cannot leave the persisted
 * JWT behind (a fire-and-forget clear cancelled mid-write resurrects the
 * session after restart). Token nulling / store clearing never precedes
 * the two authenticated server calls, and the logged-out UI flip is the
 * LAST statement of the cleanup itself, after the durable removal.
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
 * The shared gate is the common [SessionFlight] primitive (ADR-0003): one
 * kotlinx [kotlinx.coroutines.sync.Mutex] race policy, identical on JVM and
 * wasm. The claim-or-join happens in one suspending critical section, and the
 * release completes waiters FIRST, then clears the entry only if it is still
 * the creator's own flight ([SessionFlight.release]) — non-suspending
 * `CompletableDeferred.complete` is thread-safe and idempotent, and the
 * conditional clear runs under [NonCancellable] so a cancelled creator still
 * unblocks every waiter.
 *
 * RELEASE IDENTITY: the creator completes its deferred FIRST (releasing
 * waiters) and then clears the flight only if it still holds the creator's
 * own deferred. A newer creator that claimed a fresh flight in between (it
 * saw a completed deferred, which does not count as in-flight) is never
 * erased — otherwise a third caller would miss the newer run and start a
 * duplicate, post-cleanup (unauthenticated) sequence.
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
    private val localCleanup: suspend () -> Unit,
) {
    private val gate = SessionFlight<Unit>()

    private companion object {
        const val LOGOUT_IDENTITY = "session-logout"
    }

    suspend fun logout() {
        // Claim-or-join the single in-flight run at the SessionFlight
        // boundary (one suspending critical section — the server steps below
        // run OUTSIDE it). A deferred that is already COMPLETED does not count
        // as in-flight (the creator finished and its non-suspending release may
        // not have cleared the field yet): the next caller becomes a fresh
        // creator and runs a new sequence.
        val claim = gate.claim(LOGOUT_IDENTITY)
        if (!claim.isOwner) {
            gate.join(claim) // collapse: wait for the running logout, do not re-run
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
            // NESTED finally: localCleanup runs first (AWAITED inline under
            // NonCancellable — a suspending DataStore edit cancelled
            // mid-write by Activity destruction still completes, so the
            // persisted JWT cannot survive), then waiters are released EVEN
            // IF cleanup itself throws (R2-2) — no stranded Deferred on any
            // path. `complete` is thread-safe/idempotent and the field clear
            // is non-suspending, so the release itself can never be
            // cancelled away once cleanup has finished.
            try {
                withContext(NonCancellable) { localCleanup() }
            } finally {
                gate.release(claim, Unit) // complete waiters, clear flight iff ours
            }
        }
    }
}
