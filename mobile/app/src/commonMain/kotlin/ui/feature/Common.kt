package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.sksKumulatif
import ac.undip.sso.nowMs
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlin.time.ExperimentalTime

import kotlinx.datetime.toLocalDateTime
/** Weekday order used to sort schedule rows Senin-first (0) to Minggu (6). */
internal val dayOrder = listOf("senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu")

/** Hari ini menurut zona waktu perangkat (kalender + kelas mendatang). */
internal fun todayLocalDate(): LocalDate =
    Instant.fromEpochMilliseconds(nowMs()).toLocalDateTime(TimeZone.currentSystemDefault()).date

/** Rank of a raw SIAP day string for stable weekday ordering; unknown → after minggu. */
internal fun dayRank(hari: String): Int = dayOrder.indexOf(hari.trim().lowercase()).let { if (it < 0) dayOrder.size else it }

/** Capitalize a weekday name from SIAP's lowercase token ("jumat" → "Jumat", blank → ""). */
internal fun capitalizeDay(hari: String): String = if (hari.isBlank()) "" else hari.trim().replaceFirstChar { it.uppercase() }

/** input: epoch SECONDS, output "dd MMM yyyy HH:mm" — parity dgn java.time.DateTimeFormatter lama. */
@OptIn(ExperimentalTime::class)
internal fun epochToDate(epochSec: Long): String {
    if (epochSec <= 0) return "—"
    val ldt = Instant.fromEpochSeconds(epochSec).toLocalDateTime(TimeZone.currentSystemDefault())
    val d = ldt.date
    val bulan = arrayOf("Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des")[d.monthNumber - 1]
    val hh = ldt.hour.toString().padStart(2, '0')
    val mm = ldt.minute.toString().padStart(2, '0')
    val dd = d.dayOfMonth.toString().padStart(2, '0')
    return "$dd $bulan ${d.year} $hh:$mm"
}

/** Buang keterangan dalam tanda kurung (mis. `"(GABUNGAN)"`, `"(S1-TEKNIK INFORMATIKA)"`). */
private fun stripParenthetical(raw: String): String = raw.replace(Regex("""\s*\([^)]*\)"""), "").trim()

/**
 * Nama ruang siap tampil: buang keterangan dalam tanda kurung yang dikirim SIAP
 * (mis. `"A301 (S1-TEKNIK INFORMATIKA)"` → `"A301"`, `"A303 ()"` → `"A303"`).
 * Blank/null → null supaya pemanggil bisa melewati barisnya.
 */
internal fun cleanRoomName(raw: String?): String? = raw?.let(::stripParenthetical)?.takeIf { it.isNotEmpty() }

/** Nama matkul SIAP tanpa penanda kelas, mis. `"Kewirausahaan (GABUNGAN)"` → `"Kewirausahaan"`. */
internal fun cleanCourseName(raw: String): String = stripParenthetical(raw)

internal fun formatIpk(value: Double?): String = if (value == null) "—" else {
    val whole = value.toLong()
    val frac = ((value - whole) * 100 + 0.5).toInt().coerceIn(0, 99)
    "$whole.$frac"
}

internal fun formatSks(value: Double?): String = if (value == null) "—" else ((if (value % 1.0 == 0.0) value.toInt() else value).toString())

/** Indonesian month names (calendar header + picker). */
internal val MONTH_NAMES_ID =
    listOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    )

/** Singkatan bulan Indonesia untuk label tanggal ringkas (`22 Sep`). */
internal val MONTH_SHORT_ID =
    arrayOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")

/**
 * `2006-05-26` → `26 Mei 2006`. Nilai yang tidak berpola tanggal ISO
 * dikembalikan apa adanya, jadi format SIAP lain tidak pernah hilang.
 */
internal fun formatIsoDateId(raw: String): String {
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(raw.trim()) ?: return raw
    val year = m.groupValues[1]
    val month = m.groupValues[2].toIntOrNull() ?: return raw
    val day = m.groupValues[3].toIntOrNull() ?: return raw
    if (month !in 1..12 || day !in 1..31) return raw
    return "${day} ${MONTH_SHORT_ID[month - 1]} $year"
}

@Composable
internal fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Text(
        title,
        modifier = modifier,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        color = accentForeground(),
    )
}

/**
 * Cumulative IPK/SKS cards sourced from the authoritative KHS + current-term
 * IRS (profile.ipk / profile.sksLulus are unreliable/absent). Until loads
 * complete it renders placeholders so the row keeps its size (no popping).
 */
@Composable
internal fun AcademicStats(
    repo: SsoRepository,
    modifier: Modifier = Modifier,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var khs by remember { mutableStateOf<ApiResult<SiapKhs>?>(null) }
    var irs by remember { mutableStateOf<ApiResult<SiapIrs>?>(null) }
    LaunchedEffect(attempt) {
        coroutineScope {
            launch { khs = repo.khs() }
            launch { irs = repo.irs() }
        }
    }
    AcademicStatsContent(khs = khs, irs = irs, modifier = modifier)
}

@Composable
internal fun AcademicStatsContent(
    khs: ApiResult<SiapKhs>?,
    irs: ApiResult<SiapIrs>?,
    modifier: Modifier = Modifier,
) {
    val k = (khs as? ApiResult.Success)?.data
    val i = (irs as? ApiResult.Success)?.data
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        AcademicStatCard(
            label = "IPK",
            value = k?.let { formatIpk(it.ipk) },
            loading = khs == null,
            tag = "academic-stat-ipk",
            modifier = Modifier.weight(1f),
        )
        AcademicStatCard(
            label = "SKS Kumulatif",
            value = k?.let { formatSks(it.sksKumulatif) },
            loading = khs == null,
            tag = "academic-stat-cumulative-sks",
            modifier = Modifier.weight(1f),
        )
        AcademicStatCard(
            label = "SKS Semester",
            value = i?.let { formatSks(it.totalSks) },
            loading = irs == null,
            tag = "academic-stat-semester-sks",
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun AcademicStatCard(
    label: String,
    value: String?,
    loading: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            if (loading) {
                Box(
                    Modifier
                        .testTag("$tag-skeleton")
                        .width(42.dp)
                        .height(24.dp)
                        .background(
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
                            RoundedCornerShape(6.dp),
                        ),
                )
            } else {
                Text(
                    value ?: "—",
                    modifier = Modifier.testTag("$tag-value"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Web Kulon bucket for a task — single source of truth for list grouping + counts. */
internal enum class TaskBucket { NEED, DONE, LATE }

/**
 * Categorise like the web: DONE = submitted/graded; LATE = overdue & not done;
 * NEED = active-semester course, not done, not overdue. A task that is neither
 * done nor overdue but whose course is NOT in the current semester returns null
 * (it belongs to no named bucket and only shows under "Semua").
 */
internal fun taskBucket(
    a: KulonAssignment,
    activeCourseIds: Set<Long>,
): TaskBucket? {
    val done = a.submissionStatus == "submitted" || a.submissionStatus == "graded"
    return when {
        done -> TaskBucket.DONE
        a.overdue -> TaskBucket.LATE
        a.courseId in activeCourseIds -> TaskBucket.NEED
        else -> null
    }
}

internal fun taskBucketLabel(b: TaskBucket): String =
    when (b) {
        TaskBucket.NEED -> "Perlu dikerjakan"
        TaskBucket.DONE -> "Sudah dikerjakan"
        TaskBucket.LATE -> "Terlambat"
    }

internal fun taskCounts(
    tasks: List<KulonAssignment>,
    activeCourseIds: Set<Long> = emptySet(),
): Map<TaskBucket, Int> {
    val m = mutableMapOf(TaskBucket.NEED to 0, TaskBucket.DONE to 0, TaskBucket.LATE to 0)
    tasks.forEach { taskBucket(it, activeCourseIds)?.let { b -> m[b] = m.getValue(b) + 1 } }
    return m
}
