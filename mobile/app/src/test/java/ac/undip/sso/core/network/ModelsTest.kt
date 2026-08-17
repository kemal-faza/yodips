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
            """{"nama":"ANONIM","nim":"24060121130001","prodi":"Teknik","fakultas":"F","status":"aktif","extraField":123}"""
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
}
