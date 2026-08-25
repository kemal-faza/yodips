package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun KhsScreen(
    repo: SsoRepository,
    onBack: () -> Unit,
) {
    FeatureScreen("KHS", onBack = onBack) {
        RefreshableLoadableData(load = { repo.khs() }, onRefresh = { repo.khs(force = true) }, emptyMessage = "Belum ada KHS") { khs ->
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding =
                    androidx.compose.foundation.layout
                        .PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Card(
                        Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    ) {
                        Row(Modifier.padding(16.dp)) {
                            Column {
                                Text("IPK Kumulatif", style = MaterialTheme.typography.labelLarge)
                                Spacer(Modifier.height(2.dp))
                                Text(khs.ipk.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                items(khs.semesters, key = { it.semester }) { sem ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(
                                    sem.semester,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = accentForeground(),
                                )
                                Text("IP ${sem.ip}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            }
                            if (sem.totalSks > 0) {
                                Text(
                                    "SKS ${sem.totalSks}",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            semanticNilai(sem)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun semanticNilai(sem: ac.undip.sso.core.network.SiapKhsSemester) {
    if (sem.nilai.isEmpty()) {
        Text("Belum ada nilai", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    Column {
        sem.nilai.forEach { n ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    n.mataKuliah,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                )
                Text(
                    "${n.nilaiHuruf} · SKS ${n.sks}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
        }
    }
}
