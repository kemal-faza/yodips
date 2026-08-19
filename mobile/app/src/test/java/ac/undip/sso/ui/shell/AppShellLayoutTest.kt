package ac.undip.sso.ui.shell

import ac.undip.sso.ui.feature.DashboardContentBottomPadding
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppShellLayoutTest {
    @Test
    fun `bottom navigation has five icon destinations with compact labels`() {
        // Five destinations (Dashboard, Tugas, Scan, Jadwal, Profile), each with a
        // distinct icon and a non-blank label. Scan renders as the raised center
        // FAB (no separate label); the other four are icon + 10sp label (compact
        // text size is intentionally preserved from the previous iteration).
        assertTrue(Tab.entries.size == 5)
        assertFalse(Tab.entries.any { it.label.isBlank() })
        assertTrue(BottomBarLabelSizeSp in 9..11)
        assertTrue(Tab.entries.map { it.icon }.distinct().size == Tab.entries.size)
    }

    @Test
    fun `dashboard content reserves space below bottom navigation`() {
        assertTrue(DashboardContentBottomPadding >= 16)
    }

    @Test
    fun `bottom tab taps are debounced to prevent spam jank on heavy tabs`() {
        // Policy: machine-gun taps (esp. onto the heavy Scan/QR camera) are
        // collapsed into a single navigation per window, so the camera is not
        // repeatedly torn down & re-bound. The window must be wide enough to
        // matter but short enough to stay responsive.
        assertTrue(TabTapDebounceMs >= 200L)
        assertTrue(TabTapDebounceMs <= 2000L)
    }

}
