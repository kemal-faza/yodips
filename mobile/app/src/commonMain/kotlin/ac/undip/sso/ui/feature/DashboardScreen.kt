@file:OptIn(kotlin.time.ExperimentalTime::class)
package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import ac.undip.sso.nowMs

internal const val DashboardContentBottomPadding = 32

@Composable
fun DashboardScreen(
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
) {
    var refreshTick by remember { mutableIntStateOf(0) }
    RefreshableLoadableData(
        load = { repo.profile() },
        onRefresh = {
            refreshTick++
            repo.profile(force = true)
        },
        emptyMessage = "Belum ada data",
    ) { profile ->
        DashboardContent(profile, repo, onOpenIrs, onOpenKhs, refreshTick)
    }
}

@Composable
private fun DashboardContent(
    profile: SiapProfile,
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
    refreshTick: Int,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = DashboardContentBottomPadding.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            if (profile.nama.isBlank()) "Selamat datang" else "Halo, ${profile.nama.split(' ').firstOrNull() ?: profile.nama}!",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = accentForeground(),
        )
        Text(
            "${profile.prodi} · ${profile.nim}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        AcademicStats(repo)

        MenuRow(
            items =
                listOf(
                    MenuSpec("IRS", Icons.Filled.ListAlt, onOpenIrs),
                    MenuSpec("KHS", Icons.Filled.Description, onOpenKhs),
                ),
        )

        LoadableData(load = { repo.jadwal() }, emptyMessage = "Belum ada jadwal", refreshTrigger = refreshTick) { jadwal ->
            UpcomingClasses(jadwal)
        }

        AcademicCharts(repo, refreshTick)
    }
}

data class MenuSpec(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

/** Today's weekday rank (senin=0 … minggu=6) and minutes-from-midnight. */
private fun nowMinutes(): Pair<Int, Int> {
    val now = Instant.fromEpochMilliseconds(nowMs()).toLocalDateTime(TimeZone.currentSystemDefault())
    return (now.dayOfWeek.ordinal) to (now.hour * 60 + now.minute)
}

@Composable
private fun MenuRow(items: List<MenuSpec>) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { spec ->
            Card(onClick = spec.onClick, modifier = Modifier.weight(1f)) {
                Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(spec.icon, contentDescription = spec.label, tint = accentForeground())
                    Spacer(Modifier.height(4.dp))
                    Text(spec.label, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/**
 * Minutes-from-midnight of an `HH:mm` token, else null for unparseable input.
 */
internal fun parseClockMinute(s: String): Int? {
    val ms = Regex("""^(\d{1,2}):(\d{2})$""").find(s.trim())
        ?: return null
    val h = ms.groupValues[1].toIntOrNull() ?: return null
    val m = ms.groupValues[2].toIntOrNull() ?: return null
    if (h !in 0..23 || m !in 0..59) return null
    return h * 60 + m
}

/**
 * Parse SIAP `waktu` like `"09:40:00 s/d 12:10:00"` into (startMin, endMin)
 * minutes-from-midnight. Null when the range token is missing/malformed.
 */
internal fun parseWaktu(raw: String): Pair<Int, Int>? {
    if (raw.isBlank()) return null
    val m =
        Regex("""(\d{1,2}):(\d{2})(?::\d{2})?\s*s/d\s*(\d{1,2}):(\d{2})(?::\d{2})?""", RegexOption.IGNORE_CASE).find(raw)
            ?: return null
    val start = parseClockMinute("${m.groupValues[1]}:${m.groupValues[2]}") ?: return null
    val end = parseClockMinute("${m.groupValues[3]}:${m.groupValues[4]}") ?: return null
    if (end < start) return null
    return start to end
}

/**
 * Minutes until this weekly lesson's next occurrence, measured from
 * `(nowDayRank, nowMinutes)` (dayRank senin=0 … minggu=6, minutes from midnight).
 *
 * - A lesson still in progress now returns a NEGATIVE value (→ sorted first).
 * - A lesson later in the current cycle (same/later day) returns a positive value.
 * - A lesson that already ended this cycle is assigned its next-week occurrence
 *   (+7 days) for ordering. The caller separately removes a lesson that already
 *   ended today from the dashboard list.
 */
internal fun minutesUntil(
    nowDayRank: Int,
    nowMinutes: Int,
    rank: Int,
    startMin: Int,
    endMin: Int,
): Int {
    var delta = (rank - nowDayRank + 7) % 7
    if (delta == 0) {
        when {
            nowMinutes >= startMin && nowMinutes < endMin -> return -(endMin - nowMinutes)
            startMin > nowMinutes -> return startMin - nowMinutes
            else -> delta = 7
        }
    }
    return delta * 1440 + (startMin - nowMinutes)
}

/**
 * Upcoming-class list: time-aware. Distinct course cards ordered by the minutes
 * until their next occurrence — the ongoing class first, then the nearest upcoming
 * class, ..., wrapping across the week. A class whose slot already ended today is
 * omitted. Capped at `limit`.
 */
internal fun upcomingLessons(
    source: List<SiapJadwal>,
    limit: Int = 4,
    nowDayRank: Int,
    nowMinutes: Int,
): List<SiapJadwal> =
    source
        .asSequence()
        .distinctBy { it.matakuliah.trim().lowercase() }
        .mapNotNull { j ->
            val (start, end) = parseWaktu(j.waktu) ?: return@mapNotNull null
            val rank = dayRank(j.hari)
            val delta = (rank - nowDayRank + 7) % 7
            // A class whose slot is today and has already finished is "past" → drop it.
            if (delta == 0 && nowMinutes >= end) return@mapNotNull null
            j to minutesUntil(nowDayRank, nowMinutes, rank, start, end)
        }
        .sortedBy { it.second }
        .map { it.first }
        .take(limit)
        .toList()

@Composable
private fun UpcomingClasses(source: List<SiapJadwal>) {
    // Recompute "now" every minute so the section stays current (an ongoing class
    // rolls into the next one as time passes without needing a manual refresh).
    val now by produceState(initialValue = nowMinutes()) {
        while (true) {
            value = nowMinutes()
            delay(60_000)
        }
    }
    val lessons = remember(source, now) { upcomingLessons(source, nowDayRank = now.first, nowMinutes = now.second) }
    Column {
        SectionHeader("Kelas Mendatang")
        Spacer(Modifier.height(8.dp))
        if (lessons.isEmpty()) {
            Text(
                "Belum ada kelas",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@Column
        }
        lessons.forEach { j ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(j.matakuliah, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1)
                        Text(
                            "${capitalizeDay(j.hari)} · ${j.waktu}${j.ruang?.let { " · $it" }.orEmpty()}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        if (j.hari.isBlank()) "—" else capitalizeDay(j.hari).take(3),
                        style = MaterialTheme.typography.labelMedium,
                        color = accentForeground(),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
