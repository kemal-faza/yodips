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

/** Kulon course from GET /api/kulon/courses. `timelineStatus == "inprogress"`
 *  marks the current-semester course (source of truth for "aktif"; semester
 *  name-parsing is display-only). */
@Serializable
data class KulonCourse(
    val id: Long = 0,
    val fullname: String = "",
    val shortname: String = "",
    val semester: String? = null,
    val timelineStatus: String = "",
    val lecturer: String? = null,
    /** Past-dated-section progress 0–100 (omitted/unmeasurable → null). */
    val progress: Double? = null,
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
    /** Kode MIK — kunci join yang lebih stabil daripada nama (fallback lama). */
    val kode: String = "",
    val nama: String = "",
    val hadirPct: Double = 0.0,
    val hadir: Int = 0,
    val total: Int = 0,
)

@Serializable
data class SiapNilai(
    /**
     * `id_irs` SIAP — segmen pertama dari `detailId`. Bukan id yg cukup utk
     * `get_detail_nilai` (lihat [detailId]).
     */
    val id: String? = null,
    /**
     * Full SIAP detail-id `id_irs#nim#kode` utk `GET /api/siap/nilai/:id/detail`
     * (nilai per komponen). Ada HANYA utk matkul yg web SIAP-nya menyediakan
     * rincian (semester lama spt 2024/2025 Ganjil tidak punya → null dan baris
     * KHS tidak bisa di-tap).
     */
    val detailId: String? = null,
    val kode: String = "",
    val mataKuliah: String = "",
    val sks: Double = 0.0,
    val nilaiHuruf: String = "",
    /** Nilai akhir angka (mis. 88.45) dari `nilai_akhir_angka` API. */
    val nilaiAngka: Double? = null,
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

/** Satu komponen nilai berbobot (dari get_detail_nilai SIAP). */
@Serializable
data class SiapNilaiKomponen(
    val nama: String = "",
    /** Bobot komponen dalam persen (mis. 10 utk "(10%)"). */
    val bobotPct: Double = 0.0,
    val nilai: Double = 0.0,
)

/** Rincian nilai per komponen satu matakuliah (GET /api/siap/nilai/:id/detail). */
@Serializable
data class SiapNilaiDetail(
    val id: String = "",
    val kode: String = "",
    val nama: String = "",
    val sks: Double = 0.0,
    val komponen: List<SiapNilaiKomponen> = emptyList(),
    /** Nilai akhir angka (jumlah bobot × nilai). */
    val nilaiAkhir: Double = 0.0,
    /** Stamp "last update" mentah dari halaman (dd-MM-yyyy HH:mm:ss). */
    val lastUpdate: String? = null,
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

/** File lampiran sebuah tugas (dari detail assign Kulon). */
@Serializable
data class KulonFile(
    val name: String = "",
    val url: String = "",
)

/** Status submission sebuah tugas (mirror backend KulonSubmission). */
@Serializable
data class KulonSubmission(
    val status: String = "unknown",
    val submittedAt: Long? = null,
    val grade: Double? = null,
    val maxGrade: Double? = null,
)

/** Detail lengkap satu tugas (GET /api/kulon/assignments/:id/detail?cmid=). */
@Serializable
data class KulonAssignmentDetail(
    val assignmentId: Long = 0,
    val name: String = "",
    val descriptionHtml: String = "",
    val descriptionMarkdown: String = "",
    val files: List<KulonFile> = emptyList(),
    val submission: KulonSubmission = KulonSubmission(),
    val kulonUrl: String = "",
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

/** Body POST/DELETE /api/notifications/web-device (PWA Web Push subscription). */
@Serializable
data class WebPushDeviceRequest(
    val endpoint: String = "",
    val p256dh: String = "",
    val auth: String = "",
)

/** Response GET /api/notifications/vapid-public-key (kosong bila backend belum dikonfigurasi). */
@Serializable
data class VapidPublicKeyResponse(val publicKey: String = "")

/** Response POST /api/auth/logout (backend `{ ok: true }`; idempotent on repeat). */
@Serializable
data class LogoutResponse(val ok: Boolean = true)

/** Response GET /api/auth/me — status kehadiran sesi upstream (live-probed
 *  backend, cache ~60s). `complete=false` berarti SSO/Kulon/SIAP ada yang mati
 *  walau JWT masih valid → user perlu login ulang. */
@Serializable
data class MeResponse(
    val sub: String = "",
    val authenticated: Boolean = false,
    val hasSso: Boolean = false,
    val hasMicrosoft: Boolean = false,
    val hasKulon: Boolean = false,
    val hasSiap: Boolean = false,
    val complete: Boolean = false,
)

/** Konten satu course (GET /api/kulon/courses/:id/content) — sections pertemuan
 *  berisi item materi/kuis/tugas/link/forum. Mirror backend `KulonCourseContent`
 *  (kulon-parse.ts). */
@Serializable
data class KulonCourseContent(
    val courseId: Long = 0,
    val sections: List<KulonSection> = emptyList(),
)

@Serializable
data class KulonSection(
    val id: Long = 0,
    val label: String = "",
    val dateRange: String? = null,
    val items: List<KulonContentItem> = emptyList(),
)

/** Satu item di dalam section course. Backend TIDAK mengisi `assignmentId`/
 *  `duedate` (verified 2026-08-30) — nullable sebagai pengaman saja, jangan
 *  bergantung padanya. `kind`: file|assign|quiz|url|forum|page|other. */
@Serializable
data class KulonContentItem(
    val kind: String = "other",
    val name: String = "",
    val url: String = "",
    val fileType: String? = null,
    val cmid: Long? = null,
    val assignmentId: Long? = null,
    val duedate: Long? = null,
)
