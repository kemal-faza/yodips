package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.ui.common.LoadableData
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun ProfileScreen(
    repo: SsoRepository,
    onOpenKhs: () -> Unit,
) {
    FeatureScreen("Profil") {
        LoadableData(load = { repo.profile() }, emptyMessage = "Profil belum tersedia") { p ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Card {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            p.nama,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text("NIM ${p.nim}", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(12.dp))
                        InfoRow("Prodi", p.prodi)
                        InfoRow("Fakultas", p.fakultas)
                        if (!p.angkatan.isBlank()) InfoRow("Angkatan", p.angkatan)
                        if (!p.status.isBlank()) InfoRow("Status", p.status)
                        if (!p.jalurMasuk.isNullOrBlank()) InfoRow("Jalur masuk", p.jalurMasuk!!)
                        if (!p.semesterBerjalan.isNullOrBlank()) InfoRow("Semester berjalan", p.semesterBerjalan!!)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatCard("IPK", formatIpk(p.ipk), Modifier.weight(1f))
                    StatCard("SKS Selesai", formatSks(p.sksLulus), Modifier.weight(1f))
                    StatCard("SKS Tempuh", formatSks(p.sksTempuh), Modifier.weight(1f))
                }
                TextButton(onClick = onOpenKhs) {
                    Text("Lihat KHS (nilai + IPK)", style = MaterialTheme.typography.titleSmall)
                }
            }
        }
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
    Spacer(Modifier.height(6.dp))
}
