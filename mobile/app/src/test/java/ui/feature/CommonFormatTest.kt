package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Test

/** Formatter bersama (Common.kt) — dipakai lintas layar, jadi formatnya dikunci di sini. */
class CommonFormatTest {
    @Test
    fun `formatIsoDateId renders SIAP birth date in Indonesian`() {
        assertEquals("26 Mei 2006", formatIsoDateId("2006-05-26"))
        assertEquals("1 Jan 2024", formatIsoDateId("2024-01-01"))
        assertEquals("31 Des 1999", formatIsoDateId("1999-12-31"))
    }

    @Test
    fun `formatIsoDateId keeps unparseable values untouched`() {
        assertEquals("", formatIsoDateId(""))
        assertEquals("26/05/2006", formatIsoDateId("26/05/2006"))
        assertEquals("2006-13-01", formatIsoDateId("2006-13-01")) // bulan di luar 1..12
        assertEquals("2006-05-32", formatIsoDateId("2006-05-32")) // tanggal di luar 1..31
    }

    @Test
    fun `formatSks trims the trailing zero`() {
        assertEquals("20", formatSks(20.0))
        assertEquals("2", formatSks(2.0))
        assertEquals("2.5", formatSks(2.5))
        assertEquals("—", formatSks(null))
    }

    @Test
    fun `formatIpk keeps two decimals so semester IPs align`() {
        assertEquals("3.65", formatIpk(3.65))
        assertEquals("3.60", formatIpk(3.6))
        assertEquals("3.95", formatIpk(3.95))
        assertEquals("—", formatIpk(null))
    }
}
