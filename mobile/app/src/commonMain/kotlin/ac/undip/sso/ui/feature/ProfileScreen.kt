package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.RefreshableLoadableData
import ac.undip.sso.ui.theme.ThemeController
import ac.undip.sso.ui.theme.accentForeground
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private data class PInfo(
    val label: String,
    val value: String,
    val masked: Boolean = false,
)

private data class PGroup(
    val name: String,
    val rows: List<PInfo>,
)

@Composable
fun ProfileScreen(
    repo: SsoRepository,
    themeController: ThemeController,
    onLogout: () -> Unit,
) {
    val darkTheme = themeController.dark
    FeatureScreen(
        "Profil",
        headerAction = {
            IconButton(onClick = themeController::toggle) {
                Icon(
                    if (darkTheme) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
                    contentDescription = if (darkTheme) "Mode terang" else "Mode gelap",
                    tint = accentForeground(),
                )
            }
        },
    ) {
        RefreshableLoadableData(load = {
            repo.profile()
        }, onRefresh = { repo.profile(force = true) }, emptyMessage = "Profil belum tersedia") { p ->
            ProfileContent(p, onLogout)
        }
    }
}

@Composable
private fun ProfileContent(
    p: SiapProfile,
    onLogout: () -> Unit,
) {
    var showNamaIbu by remember { mutableStateOf(false) }
    val groups =
        listOf(
            PGroup(
                "Data Diri",
                listOf(
                    PInfo("NIM", p.nim),
                    PInfo("Nama Lengkap", p.nama),
                    PInfo("Fakultas", p.fakultas),
                    PInfo("Prodi", p.prodi),
                    PInfo("Angkatan", p.angkatan),
                ),
            ),
            PGroup(
                "Kependudukan",
                listOf(
                    PInfo("Tempat lahir", p.tempatLahir.orEmpty()),
                    PInfo("Tanggal lahir", p.tanggalLahir.orEmpty()),
                    PInfo("NIK", p.nik.orEmpty()),
                    PInfo("Nama Ibu", p.namaIbu.orEmpty(), masked = true),
                    PInfo("Kode kewarganegaraan", p.kodeKewarganegaraan.orEmpty()),
                ),
            ),
            PGroup(
                "Kontak",
                listOf(
                    PInfo("Nomor HP", p.nomorHp.orEmpty()),
                    PInfo("Email SSO", p.emailSso.orEmpty()),
                    PInfo("Email pribadi", p.emailPribadi.orEmpty()),
                ),
            ),
            PGroup(
                "Alamat",
                listOf(
                    PInfo("Alamat Asal", p.alamatAsal.orEmpty()),
                    PInfo("Alamat Sekarang", p.alamatSekarang.orEmpty()),
                ),
            ),
        ).map { g -> g.copy(rows = g.rows.filter { it.value.isNotBlank() }) }

    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Identity header: initials, current semester, academic status.
        Card {
            Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(p)
                Spacer(Modifier.height(12.dp))
                Text(
                    p.nama,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = accentForeground(),
                )
                if (!p.semesterBerjalan.isNullOrBlank()) {
                    Text(
                        p.semesterBerjalan!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!p.status.isBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                        Text(
                            p.status,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        )
                    }
                }
            }
        }

        groups.forEach { group ->
            FieldGroup(group, maskShown = showNamaIbu, onToggleMask = { showNamaIbu = !showNamaIbu })
        }

        Button(
            onClick = onLogout,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Logout")
        }
    }
}

@Composable
private fun Avatar(p: SiapProfile) {
    val initials =
        p.nama
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
            .ifBlank { "?" }
    val photo = p.fotoUrl?.takeIf { it.isNotBlank() }
    Box(
        Modifier
            .size(88.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        // Loaded photo covers the initials (initial fallback stays visible beneath
        // if the image fails or is missing).
        if (photo != null) {
            ProfilePhoto(
                url = photo,
                contentDescription = "Foto profil",
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** Renders a group of label/value rows, with a reveal toggle when it holds a masked field (e.g. Nama Ibu). */
@Composable
private fun FieldGroup(
    group: PGroup,
    maskShown: Boolean = false,
    onToggleMask: (() -> Unit)? = null,
) {
    val hasMasked = group.rows.any { it.masked }
    Card {
        Column(Modifier.padding(16.dp)) {
            Text(
                group.name,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = accentForeground(),
            )
            Spacer(Modifier.height(8.dp))
            group.rows.forEach { row ->
                InfoRow(row.label, if (row.masked && !maskShown) "********" else row.value)
            }
            if (hasMasked && onToggleMask != null) {
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = onToggleMask) {
                    Text(if (maskShown) "Sembunyikan" else "Tampilkan", style = MaterialTheme.typography.labelLarge)
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
    Column(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(6.dp))
    }
}
