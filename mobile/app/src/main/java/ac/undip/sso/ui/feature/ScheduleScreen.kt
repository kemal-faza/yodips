package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import java.time.LocalDate
import java.time.YearMonth

/** Indonesian month names (calendar header). */
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

private val WEEKDAY_SHORT = listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")

/**
 * Lay out a month as a Monday-first grid of 42 cells (6 weeks) for
 * `MonthGrid`. Cells outside the month are null; inside are the day-of-month.
 */
internal fun monthGrid(year: Int, month: Int): List<Int?> {
    val first = LocalDate.of(year, month, 1)
    val lead = (first.dayOfWeek.value + 6) % 7 // Mon=0 … Sun=6
    val days = YearMonth.of(year, month).lengthOfMonth()
    val cells = MutableList<Int?>(42) { null }
    for (d in 1..days) cells[lead + d - 1] = d
    return cells
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
        .toSortedMap(compareBy { dayRank(it) })
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
    var absenByNama by remember { mutableStateOf(emptyMap<String, SiapAbsen>()) }
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
            // Ringkasan kehadiran per matkul dari endpoint SIAP absen.
            when (val r = repo.absen(force)) {
                is ApiResult.Success -> {
                    absenByNama = r.data.associate { it.nama.trim().lowercase() to it }
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
            var month by remember { mutableIntStateOf(currentCalendarMonth(byTanggal)) }
            var selected by remember { mutableStateOf<String?>(null) }
            // Default selection: today if it has meetings, else the first dated event.
            val today = LocalDate.now().toString()
            var defaultSelected by remember { mutableStateOf(if (byTanggal.containsKey(today)) today else byTanggal.keys.minOrNull()) }
            if (selected == null) selected = defaultSelected
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    MonthGridHeader(
                        year = month / 100,
                        monthOfYear = month % 100,
                        byTanggal = byTanggal,
                        selected = selected,
                        onMonthChange = { y, m -> month = y * 100 + m },
                        onSelect = { selected = it },
                    )
                }
                val list = selected?.let { byTanggal[it] }.orEmpty()
                if (list.isEmpty()) {
                    item { Text("Tidak ada jadwal di tanggal ini.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    list.forEach { e ->
                        item(scheduleRowKey("", 0, e)) {
                            ScheduleCard(
                                j = e,
                                lecturer = lecturerByKode[e.kode.orEmpty()],
                                absen = absenByNama[e.matakuliah.trim().lowercase()],
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
    val base =
        if (first != null) {
            runCatching { LocalDate.parse(first) }.getOrNull() ?: LocalDate.now()
        } else {
            LocalDate.now()
        }
    return base.year * 100 + base.monthValue
}

@Composable
private fun MonthGridHeader(
    year: Int,
    monthOfYear: Int,
    byTanggal: Map<String, List<SiapJadwal>>,
    selected: String?,
    onMonthChange: (Int, Int) -> Unit,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = {
                val prev = YearMonth.of(year, monthOfYear).minusMonths(1)
                onMonthChange(prev.year, prev.monthValue)
            }) {
                Icon(Icons.Filled.ChevronLeft, contentDescription = "Bulan sebelumnya")
            }
            Text(
                monthTitle(year, monthOfYear),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            IconButton(onClick = {
                val next = YearMonth.of(year, monthOfYear).plusMonths(1)
                onMonthChange(next.year, next.monthValue)
            }) {
                Icon(Icons.Filled.ChevronRight, contentDescription = "Bulan berikutnya")
            }
        }
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
        monthGrid(year, monthOfYear).chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach { day ->
                    val date = if (day != null) LocalDate.of(year, monthOfYear, day).toString() else null
                    val hasEvent = date != null && byTanggal.containsKey(date)
                    val isSelected = date != null && date == selected
                    Box(
                        Modifier
                            .weight(1f)
                            .padding(2.dp)
                            .let { m ->
                                if (isSelected) {
                                    m.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.primary)
                                } else {
                                    m
                                }
                            }
                            .clickable(enabled = date != null) { date?.let(onSelect) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                day?.toString().orEmpty(),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (isSelected) FontWeight.Bold else if (hasEvent) FontWeight.SemiBold else FontWeight.Normal,
                                color = when {
                                    isSelected -> MaterialTheme.colorScheme.onPrimary
                                    date != null -> MaterialTheme.colorScheme.onSurface
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                },
                            )
                            Spacer(Modifier.height(2.dp))
                            Box(
                                Modifier
                                    .size(5.dp)
                                    .clip(CircleShape)
                                    .background(if (hasEvent) accentForeground() else MaterialTheme.colorScheme.surface.copy(alpha = 0f)),
                            )
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