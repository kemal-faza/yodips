package ac.undip.sso.ui.feature

import ac.undip.sso.core.data.SsoRepository
import ac.undip.sso.nowMs
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapIrsMataKuliah
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.ui.common.LoadableData
import ac.undip.sso.ui.common.REFRESH_COOLDOWN_MS
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Ordinal semester from the profile's starting year + current term label.
 * "2024" + "2026/2027 Ganjil" => (2026-2024)*2 + 1 = semester 5.
 */
internal fun semesterOrdinal(
    angkatan: String,
    semesterBerjalan: String?,
): Int? {
    if (angkatan.isBlank() || semesterBerjalan.isNullOrBlank()) return null
    val m = Regex("""(\d{4})/\d{4}\s+(\w+)""").find(semesterBerjalan.trim()) ?: return null
    val tahunMulai = m.groupValues[1].toIntOrNull() ?: return null
    val ak = angkatan.toIntOrNull() ?: return null
    if (tahunMulai < ak) return null
    val withinYear = if (m.groupValues[2].equals("Genap", ignoreCase = true)) 2 else 1
    return (tahunMulai - ak) * 2 + withinYear
}

/**
 * Build the jadwal view-model for one IRS course. The IRS payload only carries
 * kode/nama/sks/kelas/status — ruang & waktu di-join dari `repo.jadwal()`
 * (SIAP `get_jadwal` feed, match by nama matkul) supaya kartu IRS setara dengan
 * kartu Jadwal; absen (kehadiran) di-join dari `repo.absen()`.
 */
internal fun irsJadwal(mk: SiapIrsMataKuliah, jadwalByNama: Map<String, SiapJadwal>): SiapJadwal {
    val joined = jadwalByNama[mk.nama.trim().lowercase()]
    return SiapJadwal(
        kode = joined?.kode ?: mk.kode,
        matakuliah = mk.nama,
        ruang = joined?.ruang ?: mk.ruang,
        waktu = joined?.waktu ?: mk.jadwal.orEmpty(),
        sks = mk.sks,
    )
}

/**
 * Kartu IRS di-dedupe by kode MIK (fallback nama): payload backend adalah
 * gabungan IRS semua semester, jadi kursus yang mengulang — dan baris ganda
 * upstream — muncul berulang di layar (mirror web `dedupeSchedule`).
 * Occurrence pertama (semester terlama) menang.
 */
internal fun dedupeIrsMk(list: List<SiapIrsMataKuliah>): List<SiapIrsMataKuliah> =
    list.distinctBy { it.kode.ifBlank { it.nama }.trim().lowercase() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IrsScreen(
    repo: SsoRepository,
    onBack: () -> Unit,
) {
    // Nama dosen per matkul di-join dari GET /api/siap/lecturers (parse get_irs,
    // key = kode MIK); endpoint /api/siap/irs tidak menyertakan kolom dosen.
    var lecturerByKode by remember { mutableStateOf(emptyMap<String, String>()) }
    var jadwalByNama by remember { mutableStateOf(emptyMap<String, SiapJadwal>()) }
    var absenByNama by remember { mutableStateOf(emptyMap<String, SiapAbsen>()) }
    var absenByKode by remember { mutableStateOf(emptyMap<String, SiapAbsen>()) }
    FeatureScreen("IRS", onBack = onBack) {
        var refreshTick by remember { mutableIntStateOf(0) }
        var isRefreshing by remember { mutableStateOf(false) }
        val lastRefreshAt = remember { arrayOf(0L) }
        val scope = rememberCoroutineScope()
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                val now = nowMs()
                if (now - lastRefreshAt[0] < REFRESH_COOLDOWN_MS) return@PullToRefreshBox
                lastRefreshAt[0] = now
                isRefreshing = true
                scope.launch {
                    repo.profile(force = true)
                    repo.lecturers(force = true)
                    repo.jadwal(force = true)
                    repo.absen(force = true)
                    repo.irs(force = true)
                    refreshTick++
                    isRefreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Semester — derived from the profile (the IRS payload itself carries no label).
                LoadableData(load = { repo.profile() }, emptyMessage = "", refreshTrigger = refreshTick) { profile ->
                    val ordinal = semesterOrdinal(profile.angkatan, profile.semesterBerjalan)
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
                        Column(Modifier.fillMaxWidth().padding(16.dp)) {
                            Text(
                                if (ordinal != null) "Semester $ordinal" else "Semester",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            if (!profile.semesterBerjalan.isNullOrBlank()) {
                                Text(
                                    profile.semesterBerjalan!!,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }

                LoadableData(
                    load = {
                        when (val r = repo.lecturers()) {
                            is ApiResult.Success -> {
                                lecturerByKode =
                                    r.data.filter { it.dosen.isNotBlank() }.associate { it.kode to it.dosen }
                            }

                            is ApiResult.Error -> {
                                Unit
                            }
                        }
                        when (val r = repo.jadwal()) {
                            is ApiResult.Success -> {
                                jadwalByNama = r.data
                                    .filter { it.matakuliah.isNotBlank() && it.tanggal.isNotBlank() }
                                    .distinctBy { it.matakuliah.trim().lowercase() }
                                    .associate { it.matakuliah.trim().lowercase() to it }
                            }

                            is ApiResult.Error -> {
                                Unit
                            }
                        }
                        when (val r = repo.absen()) {
                            is ApiResult.Success -> {
                                absenByNama = r.data.associate { it.nama.trim().lowercase() to it }
                                // Join by kode MIK lebih tahan terhadap perbedaan
                                // format nama antar payload SIAP; nama tetap
                                // dipakai sebagai fallback (backend lama).
                                absenByKode =
                                    r.data.filter { it.kode.isNotBlank() }.associate { it.kode to it }
                            }

                            is ApiResult.Error -> {
                                Unit
                            }
                        }
                        repo.irs()
                    },
                    emptyMessage = "Belum ada IRS",
                    refreshTrigger = refreshTick,
                ) { irs ->
                    val mks = dedupeIrsMk(irs.mataKuliah)
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${mks.size} mata kuliah", style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "Total SKS ${formatSks(irs.totalSks)}",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    mks.forEach { mk ->
                        ScheduleCard(
                            j = irsJadwal(mk, jadwalByNama),
                            lecturer = lecturerByKode[mk.kode] ?: mk.dosen,
                            absen = absenByKode[mk.kode] ?: absenByNama[mk.nama.trim().lowercase()],
                            kode = mk.kode,
                        )
                        Spacer(Modifier.height(12.dp))
                    }
                }
            }
        }
    }
}