package ac.undip.sso.core.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GalleryScaleLadderTest {
    @Test
    fun `unknown source uses the full ladder`() {
        assertEquals(listOf(1920, 1280, 960), galleryScaleLadder(null))
    }

    @Test
    fun `only sizes smaller than the source are retried`() {
        assertEquals(listOf(1280, 960), galleryScaleLadder(1920))
        assertEquals(listOf(960), galleryScaleLadder(1000))
        assertEquals(emptyList<Int>(), galleryScaleLadder(960))
    }

    @Test
    fun `small screenshots are never upscaled`() {
        assertTrue(galleryScaleLadder(720).isEmpty())
    }
}
