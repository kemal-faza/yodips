package ac.undip.sso.ui.common

import ac.undip.sso.core.network.ErrorType
import org.junit.Assert.assertEquals
import org.junit.Test

class StatesTest {
    @Test
    fun `stale upstream session is not presented as expired backend session`() {
        assertEquals("Sesi berakhir", errorStateTitle(ErrorType.UNAUTHORIZED))
        assertEquals("Sesi SIAP/Kulon perlu diperbarui", errorStateTitle(ErrorType.STALE_SESSION))
    }

    @Test
    fun `non-session errors keep the generic title`() {
        assertEquals("Tidak dapat memuat data", errorStateTitle(ErrorType.NETWORK))
    }
}
