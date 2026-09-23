package ac.undip.sso.core.data

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** Keep a foreground JWT alive even when no screen happens to make a request. */
const val SESSION_REFRESH_INTERVAL_MS: Long = 60_000L

/**
 * Re-checks the session periodically for as long as the caller's lifecycle
 * scope is active. A dead backend session is terminal for this loop; a network
 * failure is retried on the next interval rather than being shown as logout.
 */
suspend fun runSessionRefreshLoop(
    ensureFresh: suspend () -> SessionRefresher.RefreshResult,
    onDeadSession: () -> Unit,
    intervalMs: Long = SESSION_REFRESH_INTERVAL_MS,
) {
    while (currentCoroutineContext().isActive) {
        when (ensureFresh()) {
            SessionRefresher.RefreshResult.DEAD_SESSION -> {
                onDeadSession()
                return
            }
            SessionRefresher.RefreshResult.SUCCESS,
            SessionRefresher.RefreshResult.NETWORK_FAILURE,
            -> delay(intervalMs)
        }
    }
}
