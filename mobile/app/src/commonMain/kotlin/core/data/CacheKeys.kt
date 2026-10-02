package ac.undip.sso.core.data

/**
 * Canonical cache keys for the fixed repository sources. Kept in one place so a
 * screen observing `SsoRepository.state(...)` can never drift from the key the
 * repository actually writes. Dynamic keys (e.g. `course-content-$id`) stay
 * local to their call site and intentionally have no observable state.
 */
object CacheKeys {
    const val PROFILE = "profile"
    const val IRS = "irs"
    const val KHS = "khs"
    const val JADWAL = "jadwal"
    const val ASSIGNMENTS = "assignments"
    const val COURSES = "courses"
    const val COURSES_LIST = "courses:list"
    const val LECTURERS = "lecturers"
    const val ABSEN = "absen"

    val ALL = listOf(PROFILE, IRS, KHS, JADWAL, ASSIGNMENTS, COURSES, COURSES_LIST, LECTURERS, ABSEN)
}
