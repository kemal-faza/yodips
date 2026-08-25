package ac.undip.sso.core.network

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Process-wide "session expired" signal.
 *
 * [SsoRepository] fires [notifySessionExpired] whenever ANY authenticated call
 * returns a 401 (expired JWT or the backend lost the upstream session — both
 * mean the user must re-login). [AppRoot] collects [events] and shows a
 * universal re-login dialog over every screen, so a dead session surfaces
 * immediately instead of silently serving stale cache from the two-tier cache.
 *
 * The value is a counter (not a boolean) so the dialog can re-arm: if it is
 * dismissed without logging out, the next 401 bumps the counter and the dialog
 * reappears. `StateFlow` conflates, so N concurrent 401s (parallel screen
 * refreshes) still yield exactly one dialog.
 *
 * Notifications are ignored while no JWT is attached to [ApiClient] — i.e.
 * after logout / on the login screen — so a dying in-flight request that lands
 * a 401 right after the user tapped "Login Ulang" cannot resurrect the dialog.
 */
object SessionExpiredEvents {
    private val _events = MutableStateFlow(0)

    val events: StateFlow<Int> = _events.asStateFlow()

    fun notifySessionExpired() {
        if (ApiClient.authToken == null) return
        _events.update { it + 1 }
    }

    fun consume() {
        _events.value = 0
    }
}
