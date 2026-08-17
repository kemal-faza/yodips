package ac.undip.sso.ui.feature

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IrsScreenTest {
    @Test
    fun `semesterOrdinal derives ordinal from angkatan + term label`() {
        assertEquals(1, semesterOrdinal("2024", "2024/2025 Ganjil"))
        assertEquals(2, semesterOrdinal("2024", "2024/2025 Genap"))
        assertEquals(5, semesterOrdinal("2024", "2026/2027 Ganjil"))
        assertEquals(6, semesterOrdinal("2024", "2026/2027 Genap"))
    }

    @Test
    fun `semesterOrdinal handles case and spacing`() {
        assertEquals(5, semesterOrdinal("2024", "2026/2027 ganjil"))
        assertEquals(5, semesterOrdinal("2024", " 2026/2027 Ganjil "))
    }

    @Test
    fun `semesterOrdinal returns null for unparseable input`() {
        assertNull(semesterOrdinal("2024", ""))
        assertNull(semesterOrdinal("", "2026/2027 Ganjil"))
        assertNull(semesterOrdinal("2024", "zzz"))
        assertNull(semesterOrdinal("2024", "2020/2021 Ganjil")) // before angkatan
    }
}
