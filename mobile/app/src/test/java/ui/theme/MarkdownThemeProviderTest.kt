package ac.undip.sso.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Kontrak typography konten instruktur: hierarchy heading yang jelas, paragraph
 * yang nyaman dibaca, link berwarna aksen. Ini mencegah regresi "deskripsi tampil
 * plain text tanpa hierarchy" (masalah yang sama pernah muncul di web karena
 * heading di-reset oleh CSS framework).
 */
class MarkdownThemeProviderTest {

    private val style = appMarkdownDocStyle(
        headingColor = Color(0xFF0A0A0A),
        bodyColor = Color(0xFF0A0A0A),
        mutedColor = Color(0xFF737373),
        linkColor = Color(0xFF01637E),
    )

    @Test
    fun `heading sizes strictly decrease with level (h5=h6 allowed)`() {
        val sizes = listOf(style.h1, style.h2, style.h3, style.h4, style.h5, style.h6)
            .map { it.fontSize.value }
        for (i in 0 until sizes.size - 1) {
            assertTrue(
                "h${i + 1} (${sizes[i]}) harus >= h${i + 2} (${sizes[i + 1]})",
                sizes[i] >= sizes[i + 1],
            )
        }
        // h5 dan h6 level terendah sama-sama >= body; h1 jelas paling besar.
        assertTrue("h1 (${sizes[0]}) harus > h6 (${sizes[5]})", sizes[0] > sizes[5])
    }

    @Test
    fun `headings are bold and bigger than body`() {
        val bodySize = style.paragraph.fontSize.value
        listOf(style.h1, style.h2, style.h3).forEach { h ->
            assertTrue("heading ${h.fontSize} harus > body $bodySize", h.fontSize.value > bodySize)
            assertTrue(
                "heading harus semi-bold+ (${h.fontWeight})",
                (h.fontWeight?.weight ?: 0) >= FontWeight.SemiBold.weight,
            )
        }
    }

    @Test
    fun `paragraph has comfortable line height`() {
        val ratio = style.paragraph.lineHeight.value / style.paragraph.fontSize.value
        assertTrue("lineHeight/fontSize=$ratio harus > 1.5", ratio > 1.5)
    }

    @Test
    fun `link is underlined and uses accent color`() {
        assertEquals(TextDecoration.Underline, style.link.style?.textDecoration)
        assertEquals(style.linkColor, style.link.style?.color)
    }    @Test
    fun `quote uses muted color`() {
        assertEquals(Color(0xFF737373), style.quote.color)
    }
}
