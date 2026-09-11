package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Test

class AssignmentDetailHelpersTest {
    @Test
    fun `decodeHtmlEntities converts double-encoded amp entity to ampersand`() {
        // "R&amp;amp;D" is what the server-side double-encode produces from "R&D";
        // decode must collapse it to a single ampersand.
        assertEquals("R&D", decodeHtmlEntities("R&amp;amp;D"))
        assertEquals("Marks & Spencer", decodeHtmlEntities("Marks &amp;amp; Spencer"))
    }

    @Test
    fun `decodeHtmlEntities handles the full core entity set`() {
        assertEquals("a < b > c \"d\" 'e'", decodeHtmlEntities("a &lt; b &gt; c &quot;d&quot; &#39;e&#39;"))
        // a mix of single-encoded and double-encoded amp: only entities decode
        assertEquals("a & b & c", decodeHtmlEntities("a &amp; b &amp;amp; c"))
    }

    @Test
    fun `decodeHtmlEntities leaves plain ampersands and named-entity text untouched`() {
        // A plain & (not part of an entity) is kept as-is
        assertEquals("Belajar & berlatih", decodeHtmlEntities("Belajar & berlatih"))
        // Named entities like &nbsp; are NOT in the decode set — keep as-is
        assertEquals("A&nbsp;B", decodeHtmlEntities("A&nbsp;B"))
        // Single-encoded &amp; (no preceding double-encode) also decodes to &
        assertEquals("R&D laporan", decodeHtmlEntities("R&amp;D laporan"))
    }
}
