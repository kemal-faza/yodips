package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapNilaiDetail
import ac.undip.sso.core.network.SiapNilaiKomponen
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Layar rincian nilai per komponen satu matakuliah (dari KHS). */
@Composable
fun NilaiDetailScreen(
    repo: SsoRepository,
    nilaiId: String,
    mataKuliah: String,
    onBack: () -> Unit,
) {
    FeatureScreen(mataKuliah, onBack = onBack) {
        LoadableData(
            load = { repo.nilaiDetail(nilaiId) },
            emptyMessage = "Detail nilai tidak tersedia.",
        ) { detail ->
            NilaiDetailContent(detail)
        }
    }
}

@Composable
private fun NilaiDetailContent(detail: SiapNilaiDetail) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Ringkasan header: kode matkul + nilai akhir menonjol.
        Card(
            Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        detail.kode,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "Nilai Akhir",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
                Text(
                    formatNilai(detail.nilaiAkhir),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }

        if (detail.komponen.isEmpty()) {
            Text(
                "Detail komponen nilai belum tersedia.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                    detail.komponen.forEachIndexed { index, komponen ->
                        KomponenRow(komponen)
                        if (index < detail.komponen.lastIndex) {
                            HorizontalDivider(Modifier.padding(vertical = 6.dp))
                        }
                    }
                }
            }
        }

        detail.lastUpdate?.let {
            Text(
                "Terakhir diperbarui: $it",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun KomponenRow(komponen: SiapNilaiKomponen) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Label komponen + bobot persen.
        Column(Modifier.weight(1f)) {
            Text(
                komponen.nama,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                "${formatBobotPct(komponen.bobotPct)} dari nilai akhir",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            formatNilai(komponen.nilai),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** 88.45 → "88,45"; 87.0 → "87"; 0 → "0" — comma desimal ala SIAP, tanpa nol gantung. */
internal fun formatNilai(value: Double): String {
    val rounded = kotlin.math.round(value * 100) / 100
    val s = rounded.toString().replace('.', ',')
    return s
}

/** 15.0 → "15%"; 12.5 → "12,5%" */
internal fun formatBobotPct(value: Double): String {
    val v = if (value == value.toLong().toDouble()) value.toLong().toDouble() else value
    return formatNilai(v) + "%"
}
