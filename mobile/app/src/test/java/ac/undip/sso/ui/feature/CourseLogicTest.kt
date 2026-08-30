package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonContentItem
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.KulonSection
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CourseLogicTest {
    private fun course(
        id: Long,
        fullname: String,
        timelineStatus: String = "past",
        semester: String? = null,
    ) = KulonCourse(id = id, fullname = fullname, timelineStatus = timelineStatus, semester = semester)

    // ---------- buckets ----------

    @Test
    fun `activeCourses filters inprogress`() {
        val cs =
            listOf(
                course(1, "A", timelineStatus = "inprogress", semester = "2026/2027 Ganjil"),
                course(2, "B", timelineStatus = "past"),
            )
        assertEquals(listOf(1L), activeCourses(cs).map { it.id })
        assertEquals(listOf(2L), pastCourses(cs).map { it.id })
    }

    @Test
    fun `actualSemester is the single unique semester or null`() {
        val cs = listOf(
            course(1, "A", timelineStatus = "inprogress", semester = "2026/2027 Ganjil"),
            course(2, "B", timelineStatus = "inprogress", semester = "2026/2027 Ganjil"),
        )
        assertEquals("2026/2027 Ganjil", actualSemester(cs))
        val mixed = cs + course(3, "C", timelineStatus = "inprogress", semester = "2025/2026 Genap")
        assertNull(actualSemester(mixed))
        assertNull(actualSemester(emptyList()))
    }

    // ---------- semester grouping ----------

    @Test
    fun `groupCoursesBySemester orders newest first and sorts by fullname inside`() {
        val past =
            listOf(
                course(1, "Zulu", semester = "2025/2026 Ganjil"),
                course(2, "Alpha", semester = "2026/2027 Ganjil"),
                course(3, "Beta", semester = "2026/2027 Ganjil"),
                course(4, "NoSem"),
            )
        val groups = groupCoursesBySemester(past)
        assertEquals(listOf("2026/2027 Ganjil", "2025/2026 Ganjil", "Tanpa semester"), groups.map { it.first })
        assertEquals(listOf("Alpha", "Beta"), groups[0].second.map { it.fullname })
    }

    @Test
    fun `semesterSortKey ranks Ganjil above Genap and newer year higher`() {
        assertTrue(semesterSortKey("2026/2027 Ganjil") > semesterSortKey("2026/2027 Genap"))
        assertTrue(semesterSortKey("2027/2028 Ganjil") > semesterSortKey("2026/2027 Ganjil"))
        assertEquals(-1, semesterSortKey(null))
        assertEquals(-1, semesterSortKey("bogus"))
    }

    // ---------- current-week detection ----------

    @Test
    fun `isCurrentWeekSection matches a range spanning now`() {
        val now = dateMs(2026, 8, 10) // 10 Aug 2026
        assertTrue(isCurrentWeekSection("9 February - 15 February", now = dateMs(2026, 2, 12)))
        assertFalse(isCurrentWeekSection("9 February - 15 February", now = dateMs(2026, 3, 1)))
    }

    @Test
    fun `isCurrentWeekSection unknown month or blank returns false`() {
        assertFalse(isCurrentWeekSection("1 Zzber - 8 Zzber", now = dateMs(2026, 2, 12)))
        assertFalse(isCurrentWeekSection(null, now = dateMs(2026, 2, 12)))
        assertFalse(isCurrentWeekSection("", now = dateMs(2026, 2, 12)))
    }

    @Test
    fun `isCurrentWeekSection boundary start and end inclusive`() {
        assertTrue(isCurrentWeekSection("9 February - 15 February 2026", now = dateMs(2026, 2, 9, 0, 0, 0)))
        assertTrue(isCurrentWeekSection("9 February - 15 February 2026", now = dateMs(2026, 2, 15, 23, 59, 59)))
    }

    @Test
    fun `isCurrentWeekSection english month names work`() {
        assertTrue(isCurrentWeekSection("9 February - 15 February", now = dateMs(2026, 2, 12)))
    }

    // ---------- default collapse ----------

    @Test
    fun `defaultCollapsed opens only current week section`() {
        val sections =
            listOf(
                section(0, "General"),
                section(1, "Pertemuan 1", "9 February - 15 February", listOf(item("file"))),
                section(2, "Pertemuan 2", "16 February - 22 February"),
            )
        val map = defaultCollapsed(sections, now = dateMs(2026, 2, 12))
        assertEquals(false, map[1]) // current week open
        assertEquals(true, map[0])
        assertEquals(true, map[2])
    }

    @Test
    fun `defaultCollapsed falls back to first non-empty section when no current week`() {
        val sections =
            listOf(
                section(0, "General"),
                section(1, "Pertemuan 1", items = listOf(item("assign"))),
                section(2, "Pertemuan 2"),
            )
        val map = defaultCollapsed(sections, now = dateMs(2026, 8, 1))
        assertEquals(false, map[1])
        assertEquals(true, map[0])
        assertEquals(true, map[2])
    }

    private fun section(
        id: Long,
        label: String,
        dateRange: String? = null,
        items: List<KulonContentItem> = emptyList(),
    ) = KulonSection(id = id, label = label, dateRange = dateRange, items = items)

    // Wall-clock fields interpreted in the JVM default zone — production
    // isCurrentWeekSection compares in TimeZone.currentSystemDefault(), so the
    // helper must build epoch millis in that same zone (not UTC) for boundary
    // tests to be meaningful on any machine.
    private fun dateMs(year: Int, month: Int, day: Int, hour: Int = 12, minute: Int = 0, second: Int = 0): Long {
        val ldt = LocalDateTime(year, month, day, hour, minute, second)
        return ldt.toInstant(TimeZone.currentSystemDefault()).toEpochMilliseconds()
    }
}
