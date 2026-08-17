package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.ui.common.LoadableData
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
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

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
    FeatureScreen("Jadwal") {
        LoadableData(load = { repo.jadwal() }, emptyMessage = "Belum ada jadwal.") { jadwal ->
            val sections = scheduleSections(jadwal)
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                sections.forEach { (day, rows) ->
                    item { SectionHeader(capitalizeDay(day)) }
                    rows.forEach { (key, e) ->
                        item(key) { ScheduleCard(e) }
                    }
                }
            }
        }
    }
}

private val SiapJadwal.kuota get() = sks

@Composable
private fun ScheduleCard(j: SiapJadwal) {
    Card {
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
                j.waktu,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(2.dp))
            if (!j.ruang.isNullOrBlank()) {
                Text("Ruang: ${j.ruang}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
