package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapLecturer
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SsoApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/** Stub-able SsoApi fake so the repository's error mapping is unit-testable. */
private class FakeApi : SsoApi {
    var profileStub: suspend () -> SiapProfile = { throw UnsupportedOperationException("profile not stubbed") }

    override suspend fun profile(): SiapProfile = profileStub()

    override suspend fun irs(): SiapIrs = throw UnsupportedOperationException()

    override suspend fun khs(): SiapKhs = throw UnsupportedOperationException()

    override suspend fun jadwal(): List<SiapJadwal> = throw UnsupportedOperationException()

    override suspend fun assignments(): List<KulonAssignment> = throw UnsupportedOperationException()

    override suspend fun courses(): List<KulonCourse> = throw UnsupportedOperationException()

    override suspend fun lecturers(): List<SiapLecturer> = throw UnsupportedOperationException()

    override suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse = throw UnsupportedOperationException()
}

class SsoRepositoryTest {
    @Test
    fun `network IO exception maps to NETWORK error`() {
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw IOException("ECONNREFUSED") } })
        val r = runBlocking { repo.profile() }
        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.NETWORK, (r as ApiResult.Error).type)
    }

    @Test
    fun `auth 401 maps to UNAUTHORIZED`() {
        val error = HttpException(Response.error<Any>(401, "expired".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.UNAUTHORIZED, (r as ApiResult.Error).type)
        assertEquals(401, r.code)
    }

    @Test
    fun `not-found 404 maps to NOT_FOUND`() {
        val error = HttpException(Response.error<Any>(404, "nf".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.NOT_FOUND, (r as ApiResult.Error).type)
    }

    @Test
    fun `upstream 4xx maps to UPSTREAM`() {
        val error = HttpException(Response.error<Any>(429, "rate".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.UPSTREAM, (r as ApiResult.Error).type)
    }

    @Test
    fun `server 5xx maps to SERVER`() {
        val error = HttpException(Response.error<Any>(503, "down".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.SERVER, (r as ApiResult.Error).type)
    }

    @Test
    fun `serialization failure maps to SERVER`() {
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw SerializationException("bad json") } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.SERVER, (r as ApiResult.Error).type)
    }

    @Test
    fun `success maps to Success`() {
        val repo = SsoRepository(FakeApi().apply { profileStub = { SiapProfile(nama = "OK", nim = "2404") } })
        val r = runBlocking { repo.profile() }
        assertTrue(r is ApiResult.Success)
        assertEquals("OK", (r as ApiResult.Success).data.nama)
    }
}
