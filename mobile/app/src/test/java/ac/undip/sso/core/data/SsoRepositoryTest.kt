package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.SiapAbsen
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

    override suspend fun absen(): List<SiapAbsen> = throw UnsupportedOperationException()

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

    @Test
    fun `auth 401 notifies the session-expired listener so the app shows re-login`() {
        // The universal dialog is driven by this signal: ANY authenticated call
        // hitting a 401 (expired JWT or backend lost the upstream session) must
        // fire it, even from a background refresh the screen never surfaces.
        var notified = 0
        val error = HttpException(Response.error<Any>(401, "expired".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } }, onSessionExpired = { notified++ })

        val r = runBlocking { repo.profile() }

        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.UNAUTHORIZED, (r as ApiResult.Error).type)
        assertEquals(1, notified)
    }

    @Test
    fun `non-auth errors do not notify the session-expired listener`() {
        var notified = 0
        val error = HttpException(Response.error<Any>(429, "rate".toResponseBody(null)))
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } }, onSessionExpired = { notified++ })

        val r = runBlocking { repo.profile() }

        assertTrue(r is ApiResult.Error)
        assertEquals(0, notified)
    }

    @Test
    fun `stale cache serves stale data immediately (stale-while-revalidate)`() {
        // The network stub is never awaited: a stale hit must return the cached
        // value now and refresh in the background, not block on the slow scrape.
        val cachedProfile = SiapProfile(nama = "CACHED", nim = "0000")
        val staleCache = SingleStaleCache(ApiResult.Success(cachedProfile))
        val api = FakeApi().apply { profileStub = { SiapProfile(nama = "FRESH-NET", nim = "9999") } }

        val r = runBlocking { SsoRepository(api, staleCache).profile() }

        assertTrue(r is ApiResult.Success)
        assertEquals("CACHED", (r as ApiResult.Success).data.nama)
    }

    @Test
    fun `cold miss restores fresh-enough data from disk before hitting the network`() {
        // Empty in-memory cache + nothing on disk would mean a blocking network
        // call. A disk entry (fresh enough) must be served instantly instead,
        // seeding the in-memory cache so a follow-up visit is cold-free.
        val onDisk = SiapProfile(nama = "FROM-DISK", nim = "1111")
        val diskJson = jsonSerializer.encodeToString(SiapProfile.serializer(), onDisk)
        val disk = MapPersistentCache(mapOf("profile" to PersistentCache.Entry(diskJson, System.currentTimeMillis())))
        val inMemory = InMemoryDataCache()
        val api = FakeApi().apply { profileStub = { SiapProfile(nama = "NET", nim = "9999") } }

        val r = runBlocking { SsoRepository(api, inMemory, disk).profile() }

        assertEquals("FROM-DISK", (r as ApiResult.Success).data.nama)
    }
}

private val jsonSerializer =
    kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

/** A [PersistentCache] that answers from a fixed map (unit-test friendly). */
private class MapPersistentCache(
    private val map: Map<String, PersistentCache.Entry>,
) : PersistentCache {
    override suspend fun load(key: String): PersistentCache.Entry? = map[key]

    override suspend fun save(
        key: String,
        json: String,
        fetchedAt: Long,
    ) = Unit
}

/** Always reports the stored value as Stale so the repository takes the stale path. */
private class SingleStaleCache(
    private val value: ApiResult<*>,
) : DataCache {
    override fun <T> get(
        key: String,
        now: Long,
    ): DataCache.Cached<ApiResult<T>>? = DataCache.Cached.Stale(value as ApiResult<T>)

    override fun <T> put(
        key: String,
        value: ApiResult<T>,
    ) {
        // no-op; the background refresh in real life writes here.
    }
}
