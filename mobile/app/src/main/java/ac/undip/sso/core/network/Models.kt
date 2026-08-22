package ac.undip.sso.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Serializable DTOs mirroring the backend JSON contracts (camelCase).
 * All optional fields carry defaults so a missing key never crashes parsing.
 * `ignoreUnknownKeys` is enabled in ApiClient's Json so extra backend fields
 * are tolerated.
 */

@Serializable
data class SiapProfile(
    val nama: String = "",
    val nim: String = "",
    val prodi: String = "",
    val fakultas: String = "",
    val angkatan: String = "",
    val jalurMasuk: String? = null,
    val semesterBerjalan: String? = null,
    val status: String = "",
    val sksTempuh: Double? = null,
    val sksLulus: Double? = null,
    val ipk: Double? = null,
    val fotoUrl: String? = null,
    val tempatLahir: String? = null,
    val tanggalLahir: String? = null,
    val nik: String? = null,
    val namaIbu: String? = null,
    val kodeKewarganegaraan: String? = null,
    val nomorHp: String? = null,
    val emailSso: String? = null,
    val emailPribadi: String? = null,
    val alamatAsal: String? = null,
    val alamatSekarang: String? = null,
)

/** Kulon course (minimal shape): id + Moodle timeline classification.
 *  `timelineStatus == "inprogress"` marks the course as in the current semester. */
@Serializable
data class KulonCourse(
    val id: Long = 0,
    val timelineStatus: String = "",
    val lecturer: String? = null,
)

/** SIAP lecturer per course code (from `get_irs`), joined to schedule by `kode` (MIK). */
@Serializable
data class SiapLecturer(
    val kode: String = "",
    val dosen: String = "",
)

/** Ringkasan kehadiran per matkul dari halaman index jadwal SIAP (kolom Hadir). */
@Serializable
data class SiapAbsen(
    val idJadwal: String = "",
    val nama: String = "",
    val hadirPct: Double = 0.0,
    val hadir: Int = 0,
    val total: Int = 0,
)

@Serializable
data class SiapNilai(
    val mataKuliah: String = "",
    val sks: Double = 0.0,
    val nilaiHuruf: String = "",
    val bobot: Double? = null,
)

@Serializable
data class SiapKhsSemester(
    val semester: String = "",
    val ip: Double = 0.0,
    val totalSks: Double = 0.0,
    val nilai: List<SiapNilai> = emptyList(),
)

@Serializable
data class SiapKhs(
    val ipk: Double = 0.0,
    val semesters: List<SiapKhsSemester> = emptyList(),
)

/** Σ SKS taken across every semester, including the current/on-going term (1 → sekarang). */
val SiapKhs.sksKumulatif: Double
    get() = semesters.sumOf { s -> s.totalSks }

@Serializable
data class SiapIrsMataKuliah(
    val kode: String = "",
    val nama: String = "",
    val sks: Double = 0.0,
    val kelas: String? = null,
    val ruang: String? = null,
    val jadwal: String? = null,
    val dosen: String? = null,
    @SerialName("status") val statusText: String = "",
)

@Serializable
data class SiapIrs(
    val semester: String = "",
    val totalSks: Double = 0.0,
    val mataKuliah: List<SiapIrsMataKuliah> = emptyList(),
)

@Serializable
data class SiapJadwal(
    val kode: String? = null,
    val hari: String = "",
    val matakuliah: String = "",
    val ruang: String? = null,
    val waktu: String = "",
    val sks: Double = 0.0,
    /** Per-pertemuan date `yyyy-MM-dd` (calendar source; also covers rescheduled meetings). */
    val tanggal: String = "",
)

@Serializable
data class KulonAssignment(
    val id: Long = 0,
    val name: String = "",
    val module: String = "",
    val eventType: String = "",
    val duedate: Long = 0,
    val overdue: Boolean = false,
    val course: String = "",
    val courseId: Long = 0,
    val assignmentId: Long = 0,
    val courseModuleId: Long = 0,
    val submissionStatus: String? = null,
)

/** Body for `POST /api/siap/kehadiran` (QR absensi proxy). */
@Serializable
data class KehadiranRequest(
    val token: String,
)

@Serializable
data class KehadiranResponse(
    val status: String = "",
    val message: String? = null,
)

/** Body POST/DELETE /api/notifications/device (spec §5). */
@Serializable
data class PushDeviceRequest(val token: String)

@Serializable
data class PushDeviceResponse(val ok: Boolean = true)
