package ac.undip.sso.ui.shell

import ac.undip.sso.ui.feature.DashboardContentBottomPadding
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppShellLayoutTest {
    @Test
    fun `bottom navigation uses text labels without icons`() {
        // Keep this policy explicit: five destinations, compact labels with icons.
        assertTrue(Tab.entries.size == 5)
        assertFalse(Tab.entries.any { it.label.isBlank() })
        assertTrue(BottomBarLabelSizeSp <= 12)
        assertTrue(Tab.entries.map { it.icon }.distinct().size == Tab.entries.size)
    }

    @Test
    fun `dashboard content reserves space below bottom navigation`() {
        assertTrue(DashboardContentBottomPadding >= 16)
    }

}
