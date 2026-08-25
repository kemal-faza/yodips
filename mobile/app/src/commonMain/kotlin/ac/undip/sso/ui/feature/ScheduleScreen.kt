@file:OptIn(kotlin.time.ExperimentalTime::class)
package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import ac.undip.sso.nowMs

private fun todayLocalDate(): LocalDate =
    Instant.fromEpochMilliseconds(nowMs()).toLocalDateTime(TimeZone.currentSystemDefault()).date

/** Indonesian month names (calendar header + picker). */
internal val MONTH_NAMES_ID =
    listOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    )

/** `2026-08` → "Agustus 2026". */
internal fun monthTitle(year: Int, month: Int): String = "${MONTH_NAMES_ID[month - 1]} $year"

/**
 * Group schedule rows by their per-meeting date (`yyyy-MM-dd`). Rows without a
 * date are dropped — the calendar only shows dated (incl. rescheduled) meetings.
 */
internal fun eventsByTanggal(jadwal: List<SiapJadwal>): Map<String, List<SiapJadwal>> =
    jadwal.filter { it.tanggal.isNotBlank() }.groupBy { it.tanggal }

/** Weekday header follows KomoUI's calendar: Sunday-first (Sun–Sat). */
internal val WEEKDAY_SHORT = listOf("Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab")

/**
 * Lay out a month as a Sunday-first grid of 42 cells (6 weeks), matching the
 * KomoUI calendar layout. Cells outside the month are null; inside are the
 * day-of-month.
 */
internal fun monthGrid(year: Int, month: Int): List<Int?> {
    val first = LocalDate(year, month, 1)
    val lead = (first.dayOfWeek.ordinal + 1) % 7 // Sun=0 … Sat=6
    val days = lengthOfMonth(year, month)
    val cells = MutableList<Int?>(42) { null }
    for (d in 1..days) cells[lead + d - 1] = d
    return cells
}

private fun lengthOfMonth(year: Int, month: Int): Int = when (month) {
    1, 3, 5, 7, 8, 10, 12 -> 31
    4, 6, 9, 11 -> 30
    2 -> if (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) 29 else 28
    else -> 0
}

/**
 * Groups jadwal by day (ordered Monday-first) assigning a globally unique, stable
 * key to every row. SIAP emits duplicate (hari, matakuliah, waktu) rows for real
 * schedules, so the per-day index disambiguates them — otherwise LazyColumn would
 * crash with "Key was already used". Extracted for unit-testing the key guarantee.
 */
internal fun scheduleSections(jadwal: List<SiapJadwal>): Map<String, List<Pair<String, SiapJadwal>>> =
    jadwal
        .groupBy { it.hari.lowercase() }
        .let { map ->
            // LinkedHashMap sorted by dayRank (replaces JVM-only toSortedMap)
            val sorted = LinkedHashMap<String, List<SiapJadwal>>()
            map.entries.sortedBy { dayRank(it.key) }.forEach { (k, v) -> sorted[k] = v }
            sorted
        }
        .mapValues { (day, entries) ->
            entries
                // SIAP emits one row per scheduled instance; collapse same-day duplicate courses.
                .distinctBy { it.matakuliah.trim().lowercase() }
                .mapIndexed { index, e -> scheduleRowKey(day, index, e) to e }
        }

private fun scheduleRowKey(
    day: String,
    index: Int,
    e: SiapJadwal,
): String = "$day-$index-${e.matakuliah}-${e.waktu}"

@Composable
fun ScheduleScreen(repo: SsoRepository) {
    var lecturerByKode by remember { mutableStateOf(emptyMap<String, String>()) }
    FeatureScreen("Jadwal") {
        suspend fun loadLookups(force: Boolean) {
            // Dosen di-join dari SIAP `get_irs` (kode MIK), bukan dari Kulon, karena
            // matkul semester berjalan tak selalu ada di daftar kursus Kulon.
            when (val r = repo.lecturers(force)) {
                is ApiResult.Success -> {
                    lecturerByKode = r.data.filter { it.dosen.isNotBlank() }.associate { it.kode to it.dosen }
                }

                is ApiResult.Error -> {
                    Unit
                }
            }
        }
        RefreshableLoadableData(
            load = {
                loadLookups(false)
                repo.jadwal()
            },
            onRefresh = {
                loadLookups(true)
                repo.jadwal(force = true)
            },
            emptyMessage = "Belum ada jadwal.",
        ) { jadwal ->
            val byTanggal = eventsByTanggal(jadwal)
            var yearMonth by remember { mutableIntStateOf(currentCalendarMonth(byTanggal)) }
            var selected by remember { mutableStateOf<String?>(null) }
            // Default selection: today if it has meetings, else the first dated event.
            val today = todayLocalDate().toString()
            var defaultSelected by remember { mutableStateOf(if (byTanggal.containsKey(today)) today else byTanggal.keys.minOrNull()) }
            if (selected == null) selected = defaultSelected
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    KomoCalendarCard(
                        year = yearMonth / 100,
                        monthOfYear = yearMonth % 100,
                        byTanggal = byTanggal,
                        selected = selected,
                        onMonthChange = { y, m -> yearMonth = y * 100 + m },
                        onSelect = { selected = it },
                    )
                }
                val list = selected?.let { byTanggal[it] }.orEmpty()
                if (list.isEmpty()) {
                    item { Text("Tidak ada jadwal di tanggal ini.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    // Kartu per tanggal: TANPA info kehadiran (user request).
                    list.forEach { e ->
                        item(scheduleRowKey("", 0, e)) {
                            ScheduleCard(
                                j = e,
                                lecturer = lecturerByKode[e.kode.orEmpty()],
                                absen = null,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Encode (year, month) as a single int; the month containing the first dated event, else now. */
internal fun currentCalendarMonth(byTanggal: Map<String, List<SiapJadwal>>): Int {
    val first = byTanggal.keys.minOrNull()
    val today = todayLocalDate()
    val base =
        if (first != null) {
            runCatching { LocalDate.parse(first) }.getOrNull() ?: today
        } else {
            today
        }
    return base.year * 100 + base.monthNumber
}

/**
 * KomoUI-style calendar card: rounded bordered container, header with
 * prev/next arrows + clickable month chip, Sunday-first weekday row, and a day
 * grid where the selected date gets a filled primary circle and today gets a
 * ring when unselected. Dates with meetings show a small accent dot; tapping a
 * date with meetings reports it. A tap on the month chip opens a picker dialog.
 */
@Composable
private fun KomoCalendarCard(
    year: Int,
    monthOfYear: Int,
    byTanggal: Map<String, List<SiapJadwal>>,
    selected: String?,
    onMonthChange: (Int, Int) -> Unit,
    onSelect: (String) -> Unit,
) {
    var showPicker by remember { mutableStateOf(false) }
    val onSurface = MaterialTheme.colorScheme.onSurface
    val primary = MaterialTheme.colorScheme.primary
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant
    val monthChip = "$year ${MONTH_NAMES_ID[monthOfYear - 1]}"
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = CardDefaults.outlinedCardBorder(),
    ) {
        Column(Modifier.padding(10.dp)) {
            // Header: previous arrow · month chip (opens picker) · next arrow
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = {
                    val (py, pm) = if (monthOfYear == 1) (year - 1) to 12 else year to (monthOfYear - 1)
                    onMonthChange(py, pm)
                }) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Bulan sebelumnya", tint = accentForeground())
                }
                Text(
                    monthChip,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { showPicker = true }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = onSurface,
                    textAlign = TextAlign.Center,
                )
                IconButton(onClick = {
                    val (ny, nm) = if (monthOfYear == 12) (year + 1) to 1 else year to (monthOfYear + 1)
                    onMonthChange(ny, nm)
                }) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Bulan berikutnya", tint = accentForeground())
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth()) {
                WEEKDAY_SHORT.forEach { w ->
                    Text(
                        w,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            monthGrid(year, monthOfYear).chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                    week.forEach { day ->
                        val date = if (day != null) LocalDate(year, monthOfYear, day).toString() else null
                        val hasEvent = date != null && byTanggal.containsKey(date)
                        val isSelected = date != null && date == selected
                        val isToday = date == todayLocalDate().toString()
                        DayCell(
                            day = day,
                            isSelected = isSelected,
                            isToday = isToday,
                            hasEvent = hasEvent,
                            primary = primary,
                            surfaceVariant = surfaceVariant,
                            onSurface = onSurface,
                            onClick = { date?.let(onSelect) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
    if (showPicker) {
        val dismiss = { showPicker = false }
        MonthPickerDialog(
            year = year,
            monthOfYear = monthOfYear,
            onPick = { y, m ->
                onMonthChange(y, m)
                showPicker = false
            },
            onDismiss = dismiss,
        )
    }
}

@Composable
private fun DayCell(
    day: Int?,
    isSelected: Boolean,
    isToday: Boolean,
    hasEvent: Boolean,
    primary: Color,
    surfaceVariant: Color,
    onSurface: Color,
    onClick: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    // 7 cells per week; each gets an equal share of the row (caller passes weight).
    Box(
        modifier
            .height(44.dp)
            .clickable(enabled = day != null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        val circleModifier =
            Modifier
                .size(38.dp)
                .then(
                    when {
                        isSelected -> Modifier.background(primary, CircleShape)
                        isToday -> Modifier.border(1.5.dp, primary, CircleShape)
                        else -> Modifier
                    },
                )
        Box(circleModifier, contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    day?.toString().orEmpty(),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = when {
                        isSelected || hasEvent -> FontWeight.SemiBold
                        else -> FontWeight.Normal
                    },
                    color = when {
                        isSelected -> MaterialTheme.colorScheme.onPrimary
                        day == null -> onSurface.copy(alpha = 0.3f)
                        isToday -> primary
                        else -> onSurface
                    },
                )
                Spacer(Modifier.height(2.dp))
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(if (hasEvent) primary else surfaceVariant.copy(alpha = 0f)),
                )
            }
        }
    }
}

/**
 * Simple month picker dialog (KomoUI-style selector): rows of the 12 month
 * names, current selection highlighted, plus a year row that can be stepped
 * with the surrounding arrows. Picking a month closes the dialog.
 */
@Composable
private fun MonthPickerDialog(
    year: Int,
    monthOfYear: Int,
    onPick: (Int, Int) -> Unit,
    onDismiss: () -> Unit,
) {
    var pickYear by remember { mutableIntStateOf(year) }
    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { pickYear-- }) {
                        Icon(Icons.Filled.ChevronLeft, contentDescription = "Tahun sebelumnya", tint = accentForeground())
                    }
                    Text(
                        "$pickYear",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    )
                    IconButton(onClick = { pickYear++ }) {
                        Icon(Icons.Filled.ChevronRight, contentDescription = "Tahun berikutnya", tint = accentForeground())
                    }
                }
                MONTH_NAMES_ID.chunked(3).forEach { rowMonths ->
                    Row(Modifier.fillMaxWidth()) {
                        rowMonths.forEach { name ->
                            val index = MONTH_NAMES_ID.indexOf(name) + 1
                            val isCurrent = pickYear == year && index == monthOfYear
                            Box(
                                Modifier
                                    .weight(1f)
                                    .padding(3.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                                    .clickable { onPick(pickYear, index) }
                                    .padding(vertical = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    name,
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (isCurrent) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun ScheduleCard(
    j: SiapJadwal,
    lecturer: String?,
    absen: SiapAbsen? = null,
    kode: String? = null,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    j.matakuliah,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${formatSks(j.sks)} SKS",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!kode.isNullOrBlank()) {
                Text(kode, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                formatWaktu(j.waktu),
                style = MaterialTheme.typography.bodyMedium,
                color = accentForeground(),
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(2.dp))
            if (!j.ruang.isNullOrBlank()) {
                Text(j.ruang, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (!lecturer.isNullOrBlank()) {
                Text(lecturer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val hadir = absen?.hadir ?: 0
            val total = absen?.total ?: 0
            if (absen != null && total > 0) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Kehadiran: $hadir/$total (${formatPct(absen.hadirPct)}%)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { (absen.hadirPct / 100.0).coerceIn(0.0, 1.0).toFloat() },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp)),
                    // Hapus stop-indicator (bulatan kecil) di ujung kanan bar.
                    drawStopIndicator = {},
                )
            }
        }
    }
}

/**
 * Format the SIAP raw time (`09:40:00 s/d 12:10:00`) into a compact `09:40 — 12:10`
 * (jam:menit, en-dash). Falls back to the raw value if the pattern does not match.
 */
internal fun formatWaktu(raw: String): String {
    if (raw.isBlank()) return raw
    val m = Regex("""(\d{1,2}:\d{2}):\d{2}\s*s/d\s*(\d{1,2}:\d{2}):\d{2}""").find(raw)
    if (m != null) return "${m.groupValues[1]} — ${m.groupValues[2]}"
    return raw
}

/** Format a percentage for display: trim trailing zeros, fall back to 0 for NaN. */
internal fun formatPct(pct: Double): String {
    if (!pct.isFinite()) return "0"
    val rounded = (pct * 10).roundToInt() / 10.0
    return if (rounded == rounded.toLong().toDouble()) rounded.toLong().toString() else rounded.toString()
}