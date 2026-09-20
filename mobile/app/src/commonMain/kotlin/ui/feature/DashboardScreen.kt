@file:OptIn(kotlin.time.ExperimentalTime::class)
package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.common.SkeletonBlock
import ac.undip.sso.ui.common.SkeletonGroup
import ac.undip.sso.ui.theme.AppCard
import ac.undip.sso.ui.theme.AppElevation
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import ac.undip.sso.nowMs

internal const val DashboardContentBottomPadding = 32

@Composable
fun DashboardScreen(
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
    onOpenNotifications: () -> Unit = {},
    onOpenCourses: () -> Unit = {},
) {
    var refreshTick by remember { mutableIntStateOf(0) }
    RefreshableLoadableData(
        load = { repo.profile() },
        onRefresh = {
            refreshTick++
            repo.profile(force = true)
        },
        emptyMessage = "Belum ada data",
        loading = { DashboardSkeleton() },
    ) { profile ->
        DashboardContent(profile, repo, onOpenIrs, onOpenKhs, onOpenNotifications, onOpenCourses, refreshTick)
    }
}

/**
 * Bentuk halaman Dashboard selama muat pertama: sapaan, tiga kartu statistik,
 * tiga kartu menu, lalu daftar kelas. Menahan tinggi tiap bagian supaya data
 * yang datang tidak menggeser layout (dulu: satu spinner di tengah layar).
 */
@Composable
private fun DashboardSkeleton() {
    SkeletonGroup {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = DashboardContentBottomPadding.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SkeletonBlock(Modifier.fillMaxWidth(0.62f).height(30.dp))
                SkeletonBlock(Modifier.fillMaxWidth(0.48f).height(16.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                repeat(3) {
                    SkeletonBlock(Modifier.weight(1f).height(74.dp), shape = RoundedCornerShape(12.dp))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                repeat(3) {
                    SkeletonBlock(Modifier.weight(1f).height(58.dp), shape = RoundedCornerShape(12.dp))
                }
            }
            SkeletonBlock(Modifier.fillMaxWidth(0.42f).height(20.dp))
            repeat(3) {
                SkeletonBlock(Modifier.fillMaxWidth().height(62.dp), shape = RoundedCornerShape(12.dp))
            }
        }
    }
}

@Composable
private fun DashboardContent(
    profile: SiapProfile,
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenCourses: () -> Unit,
    refreshTick: Int,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = DashboardContentBottomPadding.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
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
            }
            IconButton(onClick = onOpenNotifications) {
                Icon(
                    Icons.Outlined.Notifications,
                    contentDescription = "Notifikasi",
                    tint = accentForeground(),
                )
            }
        }

        AcademicStats(repo)

        MenuRow(
            items =
                listOf(
                    MenuSpec("IRS", Icons.Filled.ListAlt, onOpenIrs),
                    MenuSpec("KHS", Icons.Filled.Description, onOpenKhs),
                    MenuSpec("Mata Kuliah", Icons.Filled.MenuBook, onOpenCourses),
                ),
        )

        LoadableData(
            // force saat sudah pernah pull-to-refresh, supaya "Kelas Mendatang"
            // ikut data TERKINI (bukan cache) — bukan cuma profile yang di-force.
            load = { repo.jadwal(force = refreshTick > 0) },
            emptyMessage = "Belum ada jadwal",
            refreshTrigger = refreshTick,
        ) { jadwal ->
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
    // Tinggi seragam: Row diukur setinggi kartu tertinggi (kartu "Mata Kuliah"
    // wrap 2 baris), lalu tiap kartu fillMaxHeight — sehingga IRS/KHS tidak lebih
    // pendek dari kartu yang labelnya 2 baris. Konten tetap ikon-kiri + label.
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Max),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items.forEach { spec ->
            AppCard(
                onClick = spec.onClick,
                level = AppElevation.Lifted,
                modifier = Modifier.weight(1f).fillMaxHeight(),
            ) {
                Row(
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(spec.icon, contentDescription = spec.label, tint = accentForeground())
                    Text(
                        spec.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium,
                        // Nama menu dibiarkan WRAP (maks. 2 baris) — mis. "Mata Kuliah"
                        // tampil "Mata" / "Kuliah" saat kartu tak cukup lebar untuk satu
                        // baris penuh, daripada dipaksa satu baris yang keluar kartu.
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
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
 * Upcoming-class list: time-aware AND date-aware. Returns the next actual
 * meetings in chronological order (one card per meeting, so a course with two
 * meetings this week shows twice), capped at [limit].
 *
 * `get_jadwal` is a PER-MEETING feed (`SiapJadwal.tanggal` = `tanggal_pertemuan`),
 * NOT a weekly template: a reschedule or a switch to "daring" lives on its own
 * dated row. Selecting by the *nearest actual date* per row is what keeps this
 * section in sync with the calendar — the old `distinctBy(course)` kept the
 * earliest (often last week's) instance and showed its stale room/time.
 *
 * - Dated rows: an instance is "past" when its date is before today, or it is
 *   today and its slot already ended → dropped.
 * - Undated rows (legacy/weekly fallback): the weekly heuristic ([minutesUntil])
 *   is used, so tests/data without `tanggal` keep working.
 * - Identical rows (same date/day/course/time/room) are collapsed — SIAP can
 *   emit duplicates for one real meeting.
 */
internal fun upcomingLessons(
    source: List<SiapJadwal>,
    limit: Int = 4,
    nowDayRank: Int,
    nowMinutes: Int,
    today: LocalDate = todayLocalDate(),
): List<SiapJadwal> =
    source
        .asSequence()
        .distinctBy { row ->
            listOf(row.tanggal, row.hari, row.matakuliah, row.waktu, row.ruang.orEmpty())
                .joinToString("|")
                .trim()
                .lowercase()
        }
        .mapNotNull { j ->
            val (start, end) = parseWaktu(j.waktu) ?: return@mapNotNull null
            val sortKey = minutesUntilNextMeeting(j, today, nowDayRank, nowMinutes, start, end)
                ?: return@mapNotNull null
            j to sortKey
        }
        .sortedBy { it.second }
        .map { it.first }
        .take(limit)
        .toList()

/**
 * Comparable "minutes until this meeting starts" sort key, or null when the
 * instance is already over.
 *
 * A dated meeting uses its real date (so this week's room/time wins); an
 * undated meeting falls back to the weekly recurrence.
 */
private fun minutesUntilNextMeeting(
    j: SiapJadwal,
    today: LocalDate,
    nowDayRank: Int,
    nowMinutes: Int,
    startMin: Int,
    endMin: Int,
): Long? {
    val tanggal = j.tanggal.takeIf { it.isNotBlank() }?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    if (tanggal != null) {
        val dayDelta = tanggal.toEpochDays() - today.toEpochDays()
        if (dayDelta < 0) return null
        if (dayDelta == 0L && nowMinutes >= endMin) return null
        return dayDelta * 1440 + (startMin - nowMinutes)
    }
    val rank = dayRank(j.hari)
    val delta = (rank - nowDayRank + 7) % 7
    if (delta == 0 && nowMinutes >= endMin) return null
    return minutesUntil(nowDayRank, nowMinutes, rank, startMin, endMin).toLong()
}

/**
 * Label pertemuan untuk kartu "Kelas Mendatang": tanggal nyata `"Sen, 22 Sep"`
 * bila baris punya `tanggal`, fallback nama hari (`"Senin"`) untuk baris lama.
 * Menampilkan tanggal membuat sesi terverifikasi vs kalender (minggu ini, bukan
 * minggu lalu).
 */
internal fun meetingDateLabel(j: SiapJadwal): String {
    val tanggal = j.tanggal.takeIf { it.isNotBlank() } ?: return capitalizeDay(j.hari)
    val date = runCatching { LocalDate.parse(tanggal) }.getOrNull() ?: return capitalizeDay(j.hari)
    val day = WEEKDAY_SHORT[(date.dayOfWeek.ordinal + 1) % 7]
    return "$day, ${date.dayOfMonth} ${MONTH_SHORT_ID[date.monthNumber - 1]}"
}

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
            AppCard {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(cleanCourseName(j.matakuliah), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1)
                        Text(
                            "${meetingDateLabel(j)} · ${formatWaktu(j.waktu)}${cleanRoomName(j.ruang)?.let { " · $it" }.orEmpty()}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        meetingDateLabel(j).ifBlank { "—" }.substringBefore(','),
                        style = MaterialTheme.typography.labelMedium,
                        color = accentForeground(),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
