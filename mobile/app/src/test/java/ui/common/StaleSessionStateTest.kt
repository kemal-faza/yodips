package ac.undip.sso.ui.common

import ac.undip.sso.core.network.UpstreamSessionService
import org.junit.Assert.assertEquals
import org.junit.Test

class StaleSessionStateTest {
    @Test
    fun `labels the Kulon service`() {
        assertEquals("Kulon", staleServiceLabel(UpstreamSessionService.KULON))
    }

    @Test
    fun `labels the SIAP service`() {
        assertEquals("SIAP", staleServiceLabel(UpstreamSessionService.SIAP))
    }
}
