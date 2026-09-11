package ac.undip.sso.core.network

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * Process-wide "session expired" signal used by AppRoot to show the universal
 * re-login dialog. Counter semantics (not boolean) are what let the dialog
 * re-arm after a dismiss-and-keep-using: the next 401 must re-trigger it.
 */
class SessionExpiredEventsTest {
    @Before
    fun reset() {
        Backend.authToken = null
        SessionExpiredEvents.consume()
    }

    @After
    fun tearDown() = reset()

    @Test
    fun `notify with an active JWT bumps the event counter`() {
        Backend.authToken = "jwt-token"

        SessionExpiredEvents.notifySessionExpired()

        assertEquals(1, SessionExpiredEvents.events.value)
    }

    @Test
    fun `consume resets the counter so a later 401 can re-arm the dialog`() {
        Backend.authToken = "jwt-token"
        SessionExpiredEvents.notifySessionExpired()
        SessionExpiredEvents.consume()
        assertEquals(0, SessionExpiredEvents.events.value)

        SessionExpiredEvents.notifySessionExpired()
        assertEquals(1, SessionExpiredEvents.events.value)
    }

    @Test
    fun `notify is ignored while no JWT is attached (post-logout in-flight 401)`() {
        // After the user taps "Login Ulang" the JWT is detached first; a dying
        // in-flight request that then lands a 401 must NOT resurrect the dialog
        // on top of the login screen.
        Backend.authToken = null

        SessionExpiredEvents.notifySessionExpired()

        assertEquals(0, SessionExpiredEvents.events.value)
    }
}
