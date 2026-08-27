package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Test

class AssignmentDetailTextTest {
    @Test
    fun `strips tags and preserves readable text`() {
        val html = "<p>Kerjakan <strong>modul 1</strong> dan <em>kumpulkan</em>.</p>"
        assertEquals("Kerjakan modul 1 dan kumpulkan.", htmlToPlainText(html))
    }

    @Test
    fun `collapses surrounding whitespace and multiple newlines`() {
        val html = "<div>\n  \n <p>Baris pertama.</p>\n <p>Baris kedua.</p>\n</div>"
        assertEquals("Baris pertama.\nBaris kedua.", htmlToPlainText(html))
    }

    @Test
    fun `strips script and style content`() {
        val html = "<style>.x{color:red}</style><p>Konten nyata</p><script>alert(1)</script>"
        assertEquals("Konten nyata", htmlToPlainText(html))
    }

    @Test
    fun `converts list items and handles entities`() {
        val html = "<ul><li>Poin A</li><li>Poin B</li></ul>"
        assertEquals("• Poin A\n• Poin B", htmlToPlainText(html))
    }

    @Test
    fun `blank html yields empty string`() {
        assertEquals("", htmlToPlainText(""))
        assertEquals("", htmlToPlainText("<p>  </p>"))
    }
}
