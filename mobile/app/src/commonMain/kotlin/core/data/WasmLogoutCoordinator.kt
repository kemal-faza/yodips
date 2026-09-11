package ac.undip.sso.core.data

import kotlinx.coroutines.CancellationException

/**
 * Production-used side-effect coordinator for the wasmJs (PWA) logout path.
 *
 * AppRoot.wasmJs wires this into [SessionLogout] (as its [SessionLogout]
 * `pushUnregister` + `localCleanup` steps), so the ordering below is the
 * production ordering — not a test-only shape:
 *  - [pushUnregister] runs while the bearer is still live: server DELETE
 *    first (best-attempt prune; an ordinary failure never blocks the
 *    browser step), then UNCONDITIONAL browser unsubscribe. Structured
 *    [CancellationException] propagates from either step (never converted
 *    into best-effort); a server-side cancellation skips the browser step,
 *    exactly like the Android push path.
 *  - [localCleanup] is SUSPENDING (`suspend () -> Unit`, awaited inline by
 *    [SessionLogout] under NonCancellable) and runs LAST: history clear is
 *    only SCHEDULED (IndexedDB suspends), while the persisted JWT is removed
 *    SYNCHRONOUSLY inline via [Ops.clearPersistedCredentialsImmediately]
 *    BEFORE the first suspension point and BEFORE [Ops.showLoggedOutUi]
 *    flips the UI — the synchronous removal never awaits anything, so no
 *    cancellation can interleave between it and the call, and a scheduled
 *    clear would let the logged-out UI outrun the localStorage removal (a
 *    kill/restart in between resurrects the session). Production
 *    `TokenStore.wasmJs.clear()` delegates to the same `clearImmediately()`
 *    primitive, so both paths remove identical state.
 *
 * No browser/DOM API enters common code: every platform effect (push
 * support probe, server DELETE, browser unsubscribe, history scheduling,
 * bearer nulling, credential deletion, UI flip) arrives as an injected
 * [Ops] lambda, keeping this seam minimal and JVM-testable.
 */
class WasmLogoutCoordinator(private val ops: Ops) {
    interface Ops {
        fun isPushSupported(): Boolean
        suspend fun unregisterWebPushOnServer()
        suspend fun unsubscribeWebPushInBrowser()
        fun scheduleHistoryClear()
        fun clearAuthToken()
        fun clearPersistedCredentialsImmediately()
        fun showLoggedOutUi()
    }

    suspend fun pushUnregister() {
        if (!ops.isPushSupported()) return
        try {
            ops.unregisterWebPushOnServer()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // best-effort DELETE — browser unsubscribe below is unconditional
        }
        try {
            ops.unsubscribeWebPushInBrowser()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // best-effort — cleanup and revoke still run
        }
    }

    suspend fun localCleanup() {
        ops.scheduleHistoryClear()
        ops.clearAuthToken()
        // SYNCHRONOUS persisted-JWT removal: this call itself never suspends
        // (localStorage + StateFlow reset inline), so it completes BEFORE the
        // first suspension point below and BEFORE the UI flip — even under
        // cancellation, which NonCancellable defers until after this returns.
        ops.clearPersistedCredentialsImmediately()
        ops.showLoggedOutUi()
    }
}
