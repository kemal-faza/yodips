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
    fun `duplicate rows get unique keys - no LazyColumn key collision`() {
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

        // every key globally unique (the exact property LazyColumn requires)
        assertEquals(allKeys.size, allKeys.toSet().size)
        // nothing dropped
        assertEquals(5, allKeys.size)
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
}
