package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.UserMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The gallery retry ladder is the fix for full-resolution photos that the
 * detector cannot read (verified: 2160x3840 photo → 0 codes, same photo at
 * 1920/1280/960 → 1 code). These tests pin the contract the Android decoder
 * relies on: never upscale, never retry the size that just failed, and always
 * surface a human message instead of silence.
 */
class GalleryDecodePolicyTest {
    @Test
    fun `a large photo retries every rung below its own long edge`() {
        assertEquals(listOf(1920, 1280, 960), galleryRetryLongEdges(3840))
        assertEquals(listOf(1920, 1280, 960), galleryRetryLongEdges(2160))
    }

    @Test
    fun `the source size itself is never retried`() {
        assertEquals(listOf(1280, 960), galleryRetryLongEdges(1920))
        assertEquals(listOf(1280, 960), galleryRetryLongEdges(1600))
        assertEquals(listOf(960), galleryRetryLongEdges(1280))
        assertEquals(listOf(960), galleryRetryLongEdges(1000))
        assertEquals(emptyList<Int>(), galleryRetryLongEdges(960))
        assertEquals(emptyList<Int>(), galleryRetryLongEdges(720))
    }

    @Test
    fun `unknown source dimensions still get the full ladder`() {
        assertEquals(listOf(1920, 1280, 960), galleryRetryLongEdges(null))
    }

    @Test
    fun `each ladder shrinks, largest first, without duplicates`() {
        for (source in listOf(3840, 2160, 1920, 1600, 1280, 960, 480)) {
            val ladder = galleryRetryLongEdges(source)
            ladder.zipWithNext().forEach { (bigger, smaller) -> assertTrue(bigger > smaller) }
            assertTrue(ladder.all { it < source })
            assertEquals(ladder.distinct(), ladder)
        }
    }

    @Test
    fun `a found QR has no failure copy`() {
        assertNull(GalleryDecode.Qr("token").failureMessage())
    }

    @Test
    fun `an unreadable file and a photo without a QR get different messages`() {
        assertEquals(UserMessages.QR_NOT_FOUND, GalleryDecode.NoQr.failureMessage())
        assertEquals(UserMessages.PHOTO_UNREADABLE, GalleryDecode.ImageUnreadable.failureMessage())
    }
}
