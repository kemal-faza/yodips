package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.SiapIrsMataKuliah
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

    // ---------- dedupeIrsMk (fix kartu IRS duplikat) ----------

    private fun mk(
        kode: String,
        nama: String,
    ) = SiapIrsMataKuliah(kode = kode, nama = nama, sks = 3.0)

    // Payload backend = gabungan IRS semua semester; kursus mengulang (dan
    // baris ganda upstream) muncul berulang. Mirror web `dedupeSchedule`:
    // kemunculan PERTAMA menang.
    @Test
    fun `dedupeIrsMk collapses repeated kode keeping first occurrence`() {
        val out =
            dedupeIrsMk(
                listOf(
                    mk("MIK1624503", "Sistem Informasi"),
                    mk("MIK1624103", "Komputasi Tersebar"),
                    mk("MIK1624503", "Sistem Informasi"), // duplikat persis
                    mk("MIK1624103", "Komputasi Tersebar"), // duplikat antar-semester
                ),
            )
        assertEquals(2, out.size)
        assertEquals("MIK1624503", out[0].kode)
        assertEquals("MIK1624103", out[1].kode)
    }

    @Test
    fun `dedupeIrsMk falls back to nama when kode is blank`() {
        val out =
            dedupeIrsMk(
                listOf(
                    mk("", "Kewirausahaan"),
                    mk("", "Kewirausahaan "),
                    mk("", "Basis Data"),
                ),
            )
        assertEquals(2, out.size)
    }

    @Test
    fun `dedupeIrsMk treats kode case-insensitively`() {
        val out =
            dedupeIrsMk(
                listOf(
                    mk("mik1624503", "Sistem Informasi"),
                    mk("MIK1624503", "Sistem Informasi"),
                ),
            )
        assertEquals(1, out.size)
    }

    @Test
    fun `dedupeIrsMk keeps distinct courses with the same nama but different kode`() {
        val out =
            dedupeIrsMk(
                listOf(
                    mk("MIK1624503", "Praktikum"),
                    mk("MIK1624504", "Praktikum"),
                ),
            )
        assertEquals(2, out.size)
    }
}
