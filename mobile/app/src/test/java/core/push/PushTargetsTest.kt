package ac.undip.sso.core.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushTargetsTest {
    @Test
    fun `canonical targets accepted case-insensitively`() {
        assertEquals("tasks", normalizeNavTarget("tasks"))
        assertEquals("schedule", normalizeNavTarget("Schedule"))
        assertEquals("schedule", normalizeNavTarget(" schedule "))
    }

    @Test
    fun `unknown or absent target yields null`() {
        assertNull(normalizeNavTarget(null))
        assertNull(normalizeNavTarget(""))
        assertNull(normalizeNavTarget("profile"))
    }
}
