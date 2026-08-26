package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.sksKumulatif
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlin.time.ExperimentalTime

import kotlinx.datetime.toLocalDateTime
/** Weekday order used to sort schedule rows Senin-first (0) to Minggu (6). */
internal val dayOrder = listOf("senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu")

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

internal fun formatIpk(value: Double?): String = if (value == null) "—" else {
    val whole = value.toLong()
    val frac = ((value - whole) * 100 + 0.5).toInt().coerceIn(0, 99)
    "$whole.$frac"
}

internal fun formatSks(value: Double?): String = if (value == null) "—" else ((if (value % 1.0 == 0.0) value.toInt() else value).toString())

@Composable
internal fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
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
    val k = (khs as? ApiResult.Success)?.data
    val i = (irs as? ApiResult.Success)?.data
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatCard("IPK", formatIpk(k?.ipk), Modifier.weight(1f))
        StatCard("SKS Kumulatif", formatSks(k?.sksKumulatif), Modifier.weight(1f))
        StatCard("SKS Semester", formatSks(i?.totalSks), Modifier.weight(1f))
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
