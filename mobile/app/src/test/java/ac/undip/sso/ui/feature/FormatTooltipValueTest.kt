package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTooltipValueTest {
    @Test
    fun `3_456 rounds to 2 decimals`() {
        assertEquals("3.46", formatTooltipValue(3.456))
    }

    @Test
    fun `3_40 trims trailing zero after decimal`() {
        assertEquals("3.4", formatTooltipValue(3.40))
    }

    @Test
    fun `3_00 becomes unadorned integer`() {
        assertEquals("3", formatTooltipValue(3.00))
    }

    @Test
    fun `144_0 becomes unadorned integer`() {
        assertEquals("144", formatTooltipValue(144.0))
    }

    @Test
    fun `3_65 preserves two decimals`() {
        assertEquals("3.65", formatTooltipValue(3.65))
    }

    @Test
    fun `zero becomes 0`() {
        assertEquals("0", formatTooltipValue(0.0))
    }
}
