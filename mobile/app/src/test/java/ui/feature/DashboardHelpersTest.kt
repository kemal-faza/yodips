package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.SiapJadwal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardHelpersTest {
    private fun task(
        overdue: Boolean = false,
        submissionStatus: String? = null,
    ) = KulonAssignment(overdue = overdue, submissionStatus = submissionStatus)

    private fun row(
        hari: String,
        matakuliah: String,
        waktu: String,
        ruang: String? = null,
    ) = SiapJadwal(hari = hari, matakuliah = matakuliah, waktu = waktu, ruang = ruang)

    @Test
    fun `upcomingLessons dedupes weekly duplicate rows of the same course`() {
        // SIAP emits one row per scheduled instance; a course that repeats stays a single card.
        val source =
            listOf(
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00", "A301"),
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00", "A301"),
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00", "A301"),
                row("jumat", "Kewirausahaan", "09:50:00 s/d 11:30:00", "A301"),
                row("senin", "Sistem Informasi", "09:40:00 s/d 12:10:00", "A301"),
                row("jumat", "Basis Data", "13:00:00 s/d 15:30:00", "B201"),
            )

        val out = upcomingLessons(source, nowDayRank = 0, nowMinutes = 0)

        // one card per course (dup Kewirausahaan collapsed), senin first then by time
        assertEquals(3, out.size)
        assertEquals(listOf("Sistem Informasi", "Kewirausahaan", "Basis Data"), out.map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons orders by weekday (senin first) then time, capped at limit`() {
        val source =
            listOf(
                row("jumat", "F", "08:00:00 s/d 09:00:00"),
                row("kamis", "E", "08:00:00 s/d 09:00:00"),
                row("senin", "A", "08:00:00 s/d 09:00:00"),
                row("selasa", "B", "08:00:00 s/d 09:00:00"),
                row("rabu", "C", "12:00:00 s/d 13:00:00"),
                row("sabtu", "D", "08:00:00 s/d 09:00:00"),
            )
        assertEquals(4, upcomingLessons(source, nowDayRank = 0, nowMinutes = 0).size)
        assertEquals(listOf("A", "B", "C", "E"), upcomingLessons(source, nowDayRank = 0, nowMinutes = 0).map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons empty input yields empty`() {
        assertTrue(upcomingLessons(emptyList(), nowDayRank = 0, nowMinutes = 0).isEmpty())
    }

    @Test
    fun `upcomingLessons puts the ongoing class first`() {
        // Now: Senin 10:00. Kelas "A" (09:40-12:10) lagi berlangsung → harus pertama,
        // sebelum kelas berikutnya hari ini maupun besok.
        val source =
            listOf(
                row("senin", "Genap B", "13:00:00 s/d 15:30:00", "B201"),
                row("selasa", "Genap C", "08:00:00 s/d 10:00:00", "C301"),
                row("senin", "Ongoing A", "09:40:00 s/d 12:10:00", "A301"),
            )
        val out = upcomingLessons(source, nowDayRank = 0, nowMinutes = 10 * 60)
        assertEquals(listOf("Ongoing A", "Genap B", "Genap C"), out.map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons hides a same-day class that already ended`() {
        // Now: Senin 13:00. Kelas "A" berakhir 12:10 (sudah lewat) → di-skip ke minggu
        // depan, jadi yang muncul berikutnya "Genap B" (Selasa) bukan "A" (yang sudah usai).
        val source =
            listOf(
                row("senin", "Past A", "09:40:00 s/d 12:10:00", "A301"),
                row("selasa", "Next B", "08:00:00 s/d 10:00:00", "B201"),
            )
        val out = upcomingLessons(source, nowDayRank = 0, nowMinutes = 13 * 60)
        assertEquals(listOf("Next B"), out.map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons drops rows without a parseable time range`() {
        val source =
            listOf(
                row("senin", "NoTime", ""),
                row("senin", "Broken", "partial"),
                row("selasa", "Fresh", "09:00:00 s/d 11:00:00"),
            )
        val out = upcomingLessons(source, nowDayRank = 0, nowMinutes = 0)
        assertEquals(listOf("Fresh"), out.map { it.matakuliah })
    }

    @Test
    fun `minutesUntil ongoing is negative, future positive, ended-day wraps to next week`() {
        // Ongoing: 10:00 within [09:40, 12:10).
        assertTrue(minutesUntil(0, 10 * 60, 0, 9 * 60 + 40, 12 * 60 + 10) < 0)
        // Future same day.
        assertEquals(3 * 60, minutesUntil(0, 10 * 60, 0, 13 * 60, 15 * 60))
        // Ended earlier today → next occurrence is next Senin morning.
        assertEquals(7 * 1440 + (9 * 60 - 13 * 60), minutesUntil(0, 13 * 60, 0, 9 * 60, 10 * 60))
        // Tomorrow 08:00 measured from today 17:00.
        assertEquals(1440 + (8 * 60 - 17 * 60), minutesUntil(0, 17 * 60, 1, 8 * 60, 10 * 60))
    }

    @Test
    fun `parseWaktu parses SIAP range into start and end minutes`() {
        assertEquals(9 * 60 + 40 to 12 * 60 + 10, parseWaktu("09:40:00 s/d 12:10:00"))
        assertEquals(13 * 60 to (15 * 60 + 30), parseWaktu("13:00:00 s/d 15:30:00"))
        assertNull(parseWaktu(""))
        assertNull(parseWaktu("09:00 saja"))
        assertNull(parseWaktu("25:00:00 s/d 26:00:00"))
        assertNull(parseWaktu("14:00:00 s/d 13:00:00"))
    }

    @Test
    fun `capitalizeDay uppercases weekday, keeps blank blank`() {
        assertEquals("Jumat", capitalizeDay("jumat"))
        assertEquals("Kamis", capitalizeDay("kamis"))
        assertEquals("Senin", capitalizeDay(" senin "))
        assertEquals("", capitalizeDay(""))
    }

    @Test
    fun `taskBucket maps submissions, overdue and pending like the web`() {
        val active = setOf(0L)
        assertEquals(TaskBucket.DONE, taskBucket(task(submissionStatus = "submitted"), active))
        assertEquals(TaskBucket.DONE, taskBucket(task(submissionStatus = "graded"), active))
        assertEquals(TaskBucket.LATE, taskBucket(task(overdue = true), active))
        assertEquals(TaskBucket.NEED, taskBucket(task(), active))
        // Course not in the active semester → no named bucket (only in "Semua").
        assertEquals(null, taskBucket(task(), emptySet()))
        assertEquals(null, taskBucket(task(), setOf(99L)))
        // Overdue/submitted ignore course activity (like the web).
        assertEquals(TaskBucket.LATE, taskBucket(task(overdue = true), emptySet()))
        assertEquals(TaskBucket.DONE, taskBucket(task(submissionStatus = "submitted"), emptySet()))
    }

    @Test
    fun `taskCounts buckets and sums a mixed list`() {
        val counts =
            taskCounts(
                listOf(
                    task(overdue = true),
                    task(overdue = true),
                    task(submissionStatus = "submitted"),
                    task(),
                    task(),
                    task(),
                ),
                setOf(0L),
            )
        assertEquals(2, counts[TaskBucket.LATE])
        assertEquals(1, counts[TaskBucket.DONE])
        assertEquals(3, counts[TaskBucket.NEED])
        assertEquals(2 + 1 + 3, counts.values.sum())
    }

    @Test
    fun `dayRank maps senin-first and pushes unknown after minggu`() {
        assertEquals(0, dayRank("senin"))
        assertEquals(5, dayRank("sabtu"))
        assertEquals(6, dayRank("minggu"))
        assertEquals(7, dayRank("unknown"))
    }

    @Test
    fun `dayRank is case and whitespace tolerant`() {
        assertEquals(3, dayRank("Kamis"))
    }
}
