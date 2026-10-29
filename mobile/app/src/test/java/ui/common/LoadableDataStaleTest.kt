package ac.undip.sso.ui.common

import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.UpstreamSessionService
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoadableDataStaleTest {
    @Test
    fun `stale session with a service renders the CTA`() {
        assertTrue(isStaleForService(ErrorType.STALE_SESSION, UpstreamSessionService.SIAP))
    }

    @Test
    fun `non-stale errors keep the retry state`() {
        assertFalse(isStaleForService(ErrorType.SERVER, UpstreamSessionService.SIAP))
    }

    @Test
    fun `no service keeps the old behavior`() {
        assertFalse(isStaleForService(ErrorType.STALE_SESSION, null))
    }
}
