package ac.undip.sso.ui.feature

import ac.undip.sso.core.network.KulonContentItem
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.KulonSection
import ac.undip.sso.nowMs
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

/** Courses in the current semester — Moodle timeline classification is the source of truth. */
internal fun activeCourses(courses: List<KulonCourse>): List<KulonCourse> =
    courses.filter { it.timelineStatus == "inprogress" }

/** Courses from previous semesters (not `inprogress`). */
internal fun pastCourses(courses: List<KulonCourse>): List<KulonCourse> =
    courses.filter { it.timelineStatus != "inprogress" }

/** Subtitle semester for the "Aktif" section: the single unique semester, else null. */
internal fun actualSemester(active: List<KulonCourse>): String? {
    val sems = active.mapNotNull { it.semester }.toSet()
    return if (sems.size == 1) sems.first() else null
}

private const val NO_SEMESTER_LABEL = "Tanpa semester"

/** Mirror web `semesterSortKey` — newer year higher; Ganjil < Genap < Pendek within a year. */
internal fun semesterSortKey(semester: String?): Int {
    if (semester == null) return -1
    val m = Regex("""(20\d{2}/\d{4})\s+(Ganjil|Genap|Pendek)""", RegexOption.IGNORE_CASE).find(semester)
        ?: return -1
    val yearEnd = m.groupValues[1].substring(5, 9).toIntOrNull() ?: return -1
    val termOrder = mapOf("Ganjil" to 0, "Genap" to 1, "Pendek" to 2)
    val term = m.groupValues[2].replaceFirstChar { it.uppercase() }
    return yearEnd * 10 + (2 - (termOrder[term] ?: 0))
}

/** Group past courses by semester (newest first), fullname ascending within a group. */
internal fun groupCoursesBySemester(past: List<KulonCourse>): List<Pair<String, List<KulonCourse>>> {
    val bySem = LinkedHashMap<String, MutableList<KulonCourse>>()
    for (c in past) {
        val key = c.semester?.takeIf { it.isNotBlank() } ?: NO_SEMESTER_LABEL
        bySem.getOrPut(key) { mutableListOf() }.add(c)
    }
    return bySem
        .map { (sem, list) -> sem to list.sortedBy { it.fullname } }
        .sortedByDescending { (sem, _) -> semesterSortKey(if (sem == NO_SEMESTER_LABEL) null else sem) }
}

private val MONTH_NAMES: Map<String, Int> = mapOf(
    "januari" to 0, "jan" to 0,
    "februari" to 1, "feb" to 1,
    "maret" to 2, "mar" to 2,
    "april" to 3, "apr" to 3,
    "mei" to 4,
    "juni" to 5, "jun" to 5,
    "juli" to 6, "jul" to 6,
    "agustus" to 7, "agu" to 7, "ags" to 7,
    "september" to 8, "sep" to 8,
    "oktober" to 9, "okt" to 9,
    "november" to 10, "nov" to 10,
    "desember" to 11, "des" to 11,
    "january" to 0,
    "february" to 1,
    "march" to 2,
    "may" to 4,
    "june" to 5,
    "july" to 6,
    "august" to 7,
    "october" to 9,
    "december" to 11,
)

/**
 * Deteksi section "Minggu Ini" dari dateRange seperti "9 February - 15 February"
 * (tanpa tahun, bentuk backend) atau "18 Februari - 24 Februari 2026".
 * Bulan tak dikenal → false (jangan default ke bulan berjalan — bugfix web).
 * Boundary start/end inklusif, dibandingkan dalam epoch millis.
 */
internal fun isCurrentWeekSection(dateRange: String?, now: Long = nowMs()): Boolean {
    if (dateRange.isNullOrBlank()) return false
    val parts = dateRange.trim().split(Regex("""\s*-\s*"""))
    if (parts.size < 2) return false
    val zone = TimeZone.currentSystemDefault()
    val nowYear = Instant.fromEpochMilliseconds(now).toLocalDateTime(zone).year
    val year = Regex("""\b(20\d{2})\b""").find(dateRange)?.groupValues?.get(1)?.toIntOrNull() ?: nowYear
    fun tokens(s: String): Triple<Int, Int, Int>? {
        val t = s.trim().split(Regex("""\s+"""))
        if (t.size < 2) return null
        val day = t[0].toIntOrNull() ?: return null
        val month = MONTH_NAMES[t[1].lowercase()] ?: return null
        return Triple(day, month, year)
    }
    val start = tokens(parts[0]) ?: return false
    val end = tokens(parts[1]) ?: return false
    val startDate = LocalDate(start.third, start.second + 1, start.first)
    val endDate = LocalDate(end.third, end.second + 1, end.first)
    val startMs = startDate.atStartOfDayIn(zone).toEpochMilliseconds()
    val endMs = endDate.plus(1, DateTimeUnit.DAY).atStartOfDayIn(zone).toEpochMilliseconds() - 1
    return now in startMs..endMs
}

/** Initial section collapse state — parity web: current-week open, rest collapsed. */
internal fun defaultCollapsed(sections: List<KulonSection>, now: Long = nowMs()): Map<Long, Boolean> {
    val map = LinkedHashMap<Long, Boolean>()
    var foundCurrent = false
    for (s in sections) {
        val isCurrent = isCurrentWeekSection(s.dateRange, now)
        if (isCurrent) foundCurrent = true
        map[s.id] = !isCurrent
    }
    if (!foundCurrent && sections.isNotEmpty()) {
        val target = sections.firstOrNull { it.items.isNotEmpty() } ?: sections.first()
        map[target.id] = false
    }
    return map
}

/** Kecil — helper agar test tidak butuh konstruktor panjang. */
internal fun item(kind: String): KulonContentItem = KulonContentItem(kind = kind)
