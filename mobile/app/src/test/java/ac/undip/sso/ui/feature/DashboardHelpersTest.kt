package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.SiapJadwal
import org.junit.Assert.assertEquals
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

        val out = upcomingLessons(source)

        // one card per course (dup Kewirausahaan collapsed), senin first then by time
        assertEquals(3, out.size)
        assertEquals(listOf("Sistem Informasi", "Kewirausahaan", "Basis Data"), out.map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons orders by weekday (senin first) then time, capped at limit`() {
        val source =
            listOf(
                row("jumat", "F", "08:00"),
                row("kamis", "E", "08:00"),
                row("senin", "A", "08:00"),
                row("selasa", "B", "08:00"),
                row("rabu", "C", "12:00"),
                row("sabtu", "D", "08:00"),
            )
        assertEquals(4, upcomingLessons(source).size)
        assertEquals(listOf("A", "B", "C", "E"), upcomingLessons(source).map { it.matakuliah })
    }

    @Test
    fun `upcomingLessons empty input yields empty`() {
        assertTrue(upcomingLessons(emptyList()).isEmpty())
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
        assertEquals(TaskBucket.DONE, taskBucket(task(submissionStatus = "submitted")))
        assertEquals(TaskBucket.DONE, taskBucket(task(submissionStatus = "graded")))
        assertEquals(TaskBucket.LATE, taskBucket(task(overdue = true)))
        assertEquals(TaskBucket.NEED, taskBucket(task()))
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
