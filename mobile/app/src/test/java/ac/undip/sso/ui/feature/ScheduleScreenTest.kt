package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.SiapJadwal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression: a real SIAP schedule contains duplicate (hari, matakuliah, waktu)
 * rows across weeks. scheduleSections must assign a globally unique key to every
 * row so LazyColumn's `key=` never throws "Key was already used" (which crashed
 * the whole app when opening the Jadwal tab).
 */
class ScheduleScreenTest {
    private fun row(
        hari: String,
        matakuliah: String,
        waktu: String,
    ) = SiapJadwal(hari = hari, matakuliah = matakuliah, waktu = waktu)

    @Test
    fun `same-day duplicate course rows collapse to one and keys stay unique`() {
        val jadwal =
            listOf(
                row("senin", "Sistem Informasi", "09:40:00 s/d 12:10:00"),
                row("senin", "Sistem Informasi", "09:40:00 s/d 12:10:00"),
                row("senin", "Sistem Informasi", "09:40:00 s/d 12:10:00"),
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00"),
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00"),
            )

        val sections = scheduleSections(jadwal)
        val allKeys = sections.values.flatten().map { it.first }

        // duplicate courses within a day are collapsed (3 senin -> 1, 2 jumat -> 1)
        assertEquals(2, allKeys.size)
        assertEquals(listOf("Sistem Informasi"), sections["senin"]!!.map { it.second.matakuliah })
        assertEquals(listOf("Kewirausahaan"), sections["jumat"]!!.map { it.second.matakuliah })
        // and the keys LazyColumn sees remain globally unique (no "Key was already used")
        assertEquals(allKeys.size, allKeys.toSet().size)
    }

    @Test
    fun `sections grouped and ordered monday first`() {
        val jadwal = listOf(row("jumat", "A", "08:00"), row("senin", "B", "09:00"))
        val sections = scheduleSections(jadwal)
        assertEquals(listOf("senin", "jumat"), sections.keys.toList())
        assertEquals("B", sections["senin"]!!.single().second.matakuliah)
        assertEquals("A", sections["jumat"]!!.single().second.matakuliah)
    }

    @Test
    fun `key embeds day index and matakuliah-waktu for readability`() {
        val e = row("senin", "Sistem Informasi", "09:40:00 s/d 12:10:00")
        val section = scheduleSections(listOf(e)).values.single()
        assertEquals("senin-0-Sistem Informasi-09:40:00 s/d 12:10:00", section.single().first)
    }

    @Test
    fun `empty list yields no sections`() {
        assertTrue(scheduleSections(emptyList()).isEmpty())
    }

    @Test
    fun `formatWaktu trims seconds and uses em-dash`() {
        assertEquals(
            "09:40 — 12:10",
            formatWaktu("09:40:00 s/d 12:10:00"),
        )
    }

    @Test
    fun `formatWaktu keeps single-digit hour and raw values as-is`() {
        assertEquals("07:00 — 09:30", formatWaktu("07:00:00 s/d 09:30:00"))
        assertEquals("alias", formatWaktu("alias"))
        assertEquals("", formatWaktu(""))
    }

    @Test
    fun `formatWaktu tolerates whitespace around the separator`() {
        assertEquals(
            "16:30 — 18:10",
            formatWaktu("16:30:00  s/d  18:10:00"),
        )
    }
}
