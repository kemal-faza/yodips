package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

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
            val sections = scheduleSections(jadwal)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                sections.forEach { (day, rows) ->
                    item { SectionHeader(capitalizeDay(day)) }
                    rows.forEach { (key, e) ->
                        item(key) {
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

@Composable
private fun ScheduleCard(
    j: SiapJadwal,
    lecturer: String?,
    absen: SiapAbsen? = null,
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
private fun formatPct(pct: Double): String {
    if (!pct.isFinite()) return "0"
    val rounded = (pct * 10).roundToInt() / 10.0
    return if (rounded == rounded.toLong().toDouble()) rounded.toLong().toString() else rounded.toString()
}
