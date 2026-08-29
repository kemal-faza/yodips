package ac.undip.sso.core.network

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors ApiClient's lenient decode config so behaviour under test matches prod. */
private val lenientJson =
    Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

class ModelsTest {
    @Test
    fun `parses SiapJadwal array from real backend shape`() {
        val s =
            """[{"kode":"MIK1624503","hari":"senin","matakuliah":"Sistem Informasi","ruang":"A301","waktu":"09:40:00 s/d 12:10:00","sks":3.0}]"""
        val arr = lenientJson.decodeFromString<List<SiapJadwal>>(s)
        assertEquals(1, arr.size)
        assertEquals("Sistem Informasi", arr[0].matakuliah)
        assertEquals("senin", arr[0].hari)
        assertEquals("A301", arr[0].ruang)
        assertEquals(3.0, arr[0].sks, 0.001)
    }

    @Test
    fun `parses SiapKhs with semesters and grades`() {
        val s =
            """{"ipk":3.65,"semesters":[{"semester":"2025/2026 Ganjil","ip":3.7,"totalSks":24,"nilai":[{"mataKuliah":"Basis Data","sks":3,"nilaiHuruf":"A","bobot":4}]}]}"""
        val k = lenientJson.decodeFromString<SiapKhs>(s)
        assertEquals(3.65, k.ipk, 0.001)
        assertEquals(1, k.semesters.size)
        assertEquals("2025/2026 Ganjil", k.semesters[0].semester)
        assertEquals("A", k.semesters[0].nilai[0].nilaiHuruf)
    }

    @Test
    fun `tolerates unknown and missing optional fields`() {
        val s =
            """{"nama":"MUHAMAD KEMAL","nim":"24040121120008","prodi":"Teknik","fakultas":"F","status":"aktif","extraField":123}"""
        val p = lenientJson.decodeFromString<SiapProfile>(s)
        assertTrue(p.nama.startsWith("MUHAMAD"))
        assertEquals("F", p.fakultas) // known field parsed
        assertEquals("", p.angkatan) // absent optional field defaults
    }

    @Test
    fun `parses SiapIrs with mataKuliah`() {
        val s =
            """{"semester":"Ganjil","totalSks":21,"mataKuliah":[{"kode":"MIK1624105","nama":"Algoritma","sks":3,"status":"disetujui"}]}"""
        val irs = lenientJson.decodeFromString<SiapIrs>(s)
        assertEquals(21.0, irs.totalSks, 0.001)
        assertEquals("disetujui", irs.mataKuliah[0].statusText)
    }

    // RED (fix indikator kehadiran): backend kini menyertakan kode MIK pada
    // item absen agar mobile bisa join by kode (fallback nama).
    @Test
    fun `parses SiapAbsen with kode`() {
        val s =
            """[{"idJadwal":"216328","kode":"MIK1624503","nama":"Sistem Informasi","hadirPct":75.0,"hadir":3,"total":4}]"""
        val arr = lenientJson.decodeFromString<List<SiapAbsen>>(s)
        assertEquals(1, arr.size)
        assertEquals("MIK1624503", arr[0].kode)
        assertEquals("Sistem Informasi", arr[0].nama)
        assertEquals(3, arr[0].hadir)
        assertEquals(4, arr[0].total)
    }

    @Test
    fun `SiapAbsen without kode still parses (older backend)`() {
        val s =
            """[{"idJadwal":"216328","nama":"Sistem Informasi","hadirPct":0.0,"hadir":0,"total":0}]"""
        val arr = lenientJson.decodeFromString<List<SiapAbsen>>(s)
        assertEquals("", arr[0].kode)
    }

    @Test
    fun `handoff body quotes cookie values as valid JSON`() {
        val one = handoffBody("abc123def", null)
        lenientJson.parseToJsonElement(one) // must be parseable (was the regression)
        assertTrue(one.contains("\"siapCookie\":\"abc123def\""))
        assertFalse(one.contains("kulonCookie"))

        val both = handoffBody("a\"b", "k\\v")
        lenientJson.parseToJsonElement(both)
        assertTrue(both.contains("\"siapCookie\":\"a\\\"b\""))
        assertTrue(both.contains("\"kulonCookie\""))
    }

    @Test
    fun `sksKumulatif sums SKS across all semesters including current`() {
        val khs =
            SiapKhs(
                ipk = 3.65,
                semesters =
                    listOf(
                        SiapKhsSemester(semester = "s1", totalSks = 20.0, ip = 3.95),
                        SiapKhsSemester(semester = "s2", totalSks = 20.0, ip = 3.6),
                        SiapKhsSemester(semester = "s3", totalSks = 20.0, ip = 3.0),
                        SiapKhsSemester(semester = "s4", totalSks = 24.0, ip = 3.38),
                        SiapKhsSemester(semester = "s5", totalSks = 23.0, ip = 0.0), // on-going, no grades yet
                    ),
            )
        // 20+20+20+24+23 = 107 — includes the current semester's taken SKS
        assertEquals(107.0, khs.sksKumulatif, 0.001)
    }

    @Test
    fun `sksKumulatif is zero for empty khs`() {
        assertEquals(0.0, SiapKhs().sksKumulatif, 0.001)
    }

    @Test
    fun `parses SiapProfile personal fields from real backend shape`() {
        val s =
            """{"nama":"MUHAMAD KEMAL FAZA","nim":"24060124120013","fakultas":"SAINS DAN MATEMATIKA","prodi":"Informatika S1","angkatan":"2024","semesterBerjalan":"2026/2027 Ganjil","status":"AKTIF","tempatLahir":"KUALA KAPUAS","tanggalLahir":"26 Mei 2006","nik":"620301 260506 0001","namaIbu":"SITI HAJJAH MARIA ULFAH","kodeKewarganegaraan":"ID","nomorHp":"089693048519","emailSso":"kemalfaza26@students.undip.ac.id","emailPribadi":"kemalfaza26@gmail.com","alamatAsal":"Jalan Kapuas","alamatSekarang":"Jl. Tanjungsari"}"""
        val p = lenientJson.decodeFromString<SiapProfile>(s)
        assertEquals("KUALA KAPUAS", p.tempatLahir)
        assertEquals("26 Mei 2006", p.tanggalLahir)
        assertEquals("620301 260506 0001", p.nik)
        assertEquals("SITI HAJJAH MARIA ULFAH", p.namaIbu)
        assertEquals("ID", p.kodeKewarganegaraan)
        assertEquals("089693048519", p.nomorHp)
        assertEquals("kemalfaza26@students.undip.ac.id", p.emailSso)
        assertEquals("kemalfaza26@gmail.com", p.emailPribadi)
        assertEquals("Jalan Kapuas", p.alamatAsal)
        assertEquals("Jl. Tanjungsari", p.alamatSekarang)
    }
}
