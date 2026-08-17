package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.ui.common.LoadableData
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
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun DashboardScreen(
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
    onOpenTasks: () -> Unit,
) {
    LoadableData(load = { repo.profile() }, emptyMessage = "Belum ada data") { profile ->
        DashboardContent(profile, repo, onOpenIrs, onOpenKhs, onOpenTasks)
    }
}

@Composable
private fun DashboardContent(
    profile: SiapProfile,
    repo: SsoRepository,
    onOpenIrs: () -> Unit,
    onOpenKhs: () -> Unit,
    onOpenTasks: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            if (profile.nama.isBlank()) "Selamat datang" else "Halo, ${profile.nama.split(' ').firstOrNull() ?: profile.nama}!",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            "${profile.prodi} · ${profile.nim}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard("IPK", formatIpk(profile.ipk), Modifier.weight(1f))
            StatCard("SKS Selesai", formatSks(profile.sksLulus), Modifier.weight(1f))
        }

        MenuRow(
            items =
                listOf(
                    MenuSpec("IRS", Icons.Filled.ListAlt, onOpenIrs),
                    MenuSpec("KHS", Icons.Filled.Description, onOpenKhs),
                    MenuSpec("Tugas", Icons.Filled.CalendarMonth, onOpenTasks),
                ),
        )

        LoadableData(load = { repo.jadwal() }, emptyMessage = "Belum ada jadwal") { jadwal ->
            upcomingClasses(jadwal.sortedBy { it.hari })
        }
    }
}

data class MenuSpec(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

@Composable
private fun MenuRow(items: List<MenuSpec>) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { spec ->
            Card(onClick = spec.onClick, modifier = Modifier.weight(1f)) {
                Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(spec.icon, contentDescription = spec.label, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(4.dp))
                    Text(spec.label, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@Composable
private fun upcomingClasses(sorted: List<ac.undip.sso.core.network.SiapJadwal>) {
    Column {
        SectionHeader("Kelas Mendatang")
        Spacer(Modifier.height(8.dp))
        sorted.take(4).forEach { j ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(j.matakuliah, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1)
                        Text(
                            "${j.hari} · ${j.waktu}${j.ruang?.let { " · $it" }.orEmpty()}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        if (j.hari.isEmpty()) "—" else j.hari.take(3),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}
