package ac.undip.sso.core.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Kontrak ekstraksi kode pairing dari teks hasil scan QR / deep-link.
 * Mirror semantik web `utils/pairing.ts::extractPairCode` — jangan drift.
 */
class PairCodeExtractTest {

    @Test
    fun `plain code passes through normalized`() {
        assertEquals("ABCD1234", extractPairCode("abcd1234"))
    }

    @Test
    fun `ambiguous chars are normalized O to 0 and I L to 1`() {
        assertEquals("C0DE1234", extractPairCode("co de 1234")) // O -> 0
        assertEquals("B1AZE678", extractPairCode("blaze678")) // L -> 1
    }

    @Test
    fun `spaces and dashes are stripped`() {
        assertEquals("ABCD1234", extractPairCode("ABCD-1234"))
        assertEquals("ABCD1234", extractPairCode(" ABCD 1234 "))
    }

    @Test
    fun `relative qr url pair param is extracted`() {
        assertEquals("ABCD1234", extractPairCode("/login?pair=ABCD1234"))
        assertEquals("ABCD1234", extractPairCode("/login?pair=abcd1234&utm=x"))
    }

    @Test
    fun `absolute url pair param is extracted`() {
        assertEquals("ABCD1234", extractPairCode("https://sso.crunchy.my.id/login?pair=ABCD1234"))
    }

    @Test
    fun `url without pair param falls back to path - invalid`() {
        assertNull(extractPairCode("https://sso.crunchy.my.id/login?other=1"))
    }

    @Test
    fun `wrong length is rejected`() {
        assertNull(extractPairCode("ABC123"))
        assertNull(extractPairCode("ABCDE12345"))
    }

    @Test
    fun `empty text is rejected`() {
        assertNull(extractPairCode(""))
        assertNull(extractPairCode("   "))
    }

    @Test
    fun `invalid characters after normalize are rejected`() {
        // U bukan bagian alfabet Crockford.
        assertNull(extractPairCode("ABCU1234"))
    }

    @Test
    fun `pair param wins over surrounding text`() {
        assertEquals("ZZZZ9999", extractPairCode("scan me /login?pair=ZZZZ9999 thanks"))
    }
}
