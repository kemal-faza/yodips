package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.KehadiranRequest
import ac.undip.sso.core.network.KehadiranResponse
import ac.undip.sso.core.network.KulonAssignment
import ac.undip.sso.core.network.KulonAssignmentDetail
import ac.undip.sso.core.network.KulonCourse
import ac.undip.sso.core.network.PushDeviceRequest
import ac.undip.sso.core.network.PushDeviceResponse
import ac.undip.sso.core.network.SiapAbsen
import ac.undip.sso.core.network.SiapIrs
import ac.undip.sso.core.network.SiapJadwal
import ac.undip.sso.core.network.SiapKhs
import ac.undip.sso.core.network.SiapLecturer
import ac.undip.sso.core.network.SiapProfile
import ac.undip.sso.core.network.SsoApi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** Fake TokenStoreLike so refresh + cookie persistence is unit-testable. */
private class FakeTokenStore(
    var siap: String? = null,
    var kulon: String? = null,
) : TokenStoreLike {
    var saved: Triple<String, String?, String?>? = null
    override val siapCookie: Flow<String?> = flowOf(siap)
    override val kulonCookie: Flow<String?> = flowOf(kulon)
    override suspend fun save(token: String, siap: String?, kulon: String?) {
        saved = Triple(token, siap, kulon)
    }
    override suspend fun currentToken(): String? = saved?.first
    override suspend fun clear() { saved = null }
}

/** Stub-able SsoApi fake so the repository's error mapping is unit-testable. */
private class FakeApi : SsoApi {
    var profileStub: suspend () -> SiapProfile = { throw UnsupportedOperationException("profile not stubbed") }
    var markKehadiranStub: suspend (KehadiranRequest) -> KehadiranResponse = { throw UnsupportedOperationException("markKehadiran not stubbed") }
    var registerPushDeviceStub: suspend (PushDeviceRequest) -> PushDeviceResponse = { throw UnsupportedOperationException("registerPushDevice not stubbed") }

    override suspend fun profile(): SiapProfile = profileStub()

    override suspend fun irs(): SiapIrs = throw UnsupportedOperationException()

    override suspend fun khs(): SiapKhs = throw UnsupportedOperationException()

    override suspend fun jadwal(): List<SiapJadwal> = throw UnsupportedOperationException()

    override suspend fun assignments(): List<KulonAssignment> = throw UnsupportedOperationException()

    override suspend fun assignmentDetail(assignmentId: Long, cmid: Long): KulonAssignmentDetail =
        throw UnsupportedOperationException()

    override suspend fun courses(): List<KulonCourse> = throw UnsupportedOperationException()

    override suspend fun lecturers(): List<SiapLecturer> = throw UnsupportedOperationException()

    override suspend fun absen(): List<SiapAbsen> = throw UnsupportedOperationException()

    override suspend fun markKehadiran(body: KehadiranRequest): KehadiranResponse = markKehadiranStub(body)

    override suspend fun registerPushDevice(body: PushDeviceRequest): PushDeviceResponse =
        registerPushDeviceStub(body)

    override suspend fun unregisterPushDevice(body: PushDeviceRequest): PushDeviceResponse =
        throw UnsupportedOperationException()
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
    fun `upstream-scraped 401 maps to STALE_SESSION`() {
        val error = ApiHttpException(401, "Session SIAP expired")
        val repo =
            SsoRepository(
                FakeApi().apply { profileStub = { throw error } },
                refreshToken = { throw ApiHttpException(401, "SESSION_DEAD") },
            )
        val r = runBlocking { repo.profile() }
        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.STALE_SESSION, (r as ApiResult.Error).type)
        assertEquals(401, r.code)
    }

    @Test
    fun `auth-level 401 on non-upstream route maps to UNAUTHORIZED`() {
        val error = ApiHttpException(401, "expired")
        val repo =
            SsoRepository(
                FakeApi().apply {
                    registerPushDeviceStub = { throw error }
                },
                refreshToken = { throw ApiHttpException(401, "SESSION_DEAD") },
            )
        val r = runBlocking { repo.registerPushDevice("tok") }
        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.UNAUTHORIZED, (r as ApiResult.Error).type)
        assertEquals(401, r.code)
    }

    @Test
    fun `not-found 404 maps to NOT_FOUND`() {
        val error = ApiHttpException(404, "nf")
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.NOT_FOUND, (r as ApiResult.Error).type)
    }

    @Test
    fun `upstream 4xx maps to UPSTREAM`() {
        val error = ApiHttpException(429, "rate")
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } })
        val r = runBlocking { repo.profile() }
        assertEquals(ErrorType.UPSTREAM, (r as ApiResult.Error).type)
    }

    @Test
    fun `server 5xx maps to SERVER`() {
        val error = ApiHttpException(503, "down")
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
        var notified = 0
        val error = ApiHttpException(401, "expired")
        val repo =
            SsoRepository(
                FakeApi().apply { profileStub = { throw error } },
                onSessionExpired = { notified++ },
                refreshToken = { throw ApiHttpException(401, "SESSION_DEAD") },
            )

        val r = runBlocking { repo.profile() }

        assertTrue(r is ApiResult.Error)
        assertEquals(ErrorType.STALE_SESSION, (r as ApiResult.Error).type)
        assertEquals(1, notified)
    }

    @Test
    fun `non-auth errors do not notify the session-expired listener`() {
        var notified = 0
        val error = ApiHttpException(429, "rate")
        val repo = SsoRepository(FakeApi().apply { profileStub = { throw error } }, onSessionExpired = { notified++ })

        val r = runBlocking { repo.profile() }

        assertTrue(r is ApiResult.Error)
        assertEquals(0, notified)
    }

    @Test
    fun `stale cache serves stale data immediately (stale-while-revalidate)`() {
        val cachedProfile = SiapProfile(nama = "CACHED", nim = "0000")
        val staleCache = SingleStaleCache(ApiResult.Success(cachedProfile))
        val api = FakeApi().apply { profileStub = { SiapProfile(nama = "FRESH-NET", nim = "9999") } }

        val r = runBlocking { SsoRepository(api, staleCache).profile() }

        assertTrue(r is ApiResult.Success)
        assertEquals("CACHED", (r as ApiResult.Success).data.nama)
    }

    @Test
    fun `cold miss restores fresh-enough data from disk before hitting the network`() {
        val onDisk = SiapProfile(nama = "FROM-DISK", nim = "1111")
        val diskJson = jsonSerializer.encodeToString(SiapProfile.serializer(), onDisk)
        val disk = MapPersistentCache(mapOf("profile" to PersistentCache.Entry(diskJson, System.currentTimeMillis())))
        val inMemory = InMemoryDataCache()
        val api = FakeApi().apply { profileStub = { SiapProfile(nama = "NET", nim = "9999") } }

        val r = runBlocking { SsoRepository(api, inMemory, disk).profile() }

        assertEquals("FROM-DISK", (r as ApiResult.Success).data.nama)
    }

    // ────────────── Silent refresh tests (Task 5) ──────────────

    @Test
    fun `401 triggers refresh then retry succeeds`() = runBlocking {
        var calls = 0
        val api = FakeApi().apply {
            profileStub = {
                calls++
                if (calls == 1) throw ApiHttpException(401, "expired")
                SiapProfile(nama = "OK", nim = "2404")
            }
        }
        val store = FakeTokenStore()
        var refreshCalls = 0
        val repo = SsoRepository(
            api,
            tokenStore = store,
            refreshToken = { refreshCalls++; "new-jwt" },
        )
        val r = repo.profile(force = true)
        assertTrue(r is ApiResult.Success)
        assertEquals(2, calls)          // original + retry
        assertEquals(1, refreshCalls)   // exactly one refresh
        assertEquals("new-jwt", store.saved?.first)
    }

    @Test
    fun `401 refresh fails 401 signals onSessionExpired, no retry`() = runBlocking {
        var notified = 0
        val api = FakeApi().apply {
            profileStub = { throw ApiHttpException(401, "expired") }
        }
        val repo = SsoRepository(
            api,
            onSessionExpired = { notified++ },
            tokenStore = FakeTokenStore(),
            refreshToken = { throw ApiHttpException(401, "SESSION_DEAD") },
        )
        val r = repo.profile(force = true)
        assertEquals(1, notified)
        assertTrue(r is ApiResult.Error && r.type == ErrorType.STALE_SESSION)
    }

    @Test
    fun `401 refresh network failure returns NETWORK error, no dialog`() = runBlocking {
        var notified = 0
        val api = FakeApi().apply {
            profileStub = { throw ApiHttpException(401, "expired") }
        }
        val repo = SsoRepository(
            api,
            onSessionExpired = { notified++ },
            tokenStore = FakeTokenStore(),
            refreshToken = { throw IOException("network down") },
        )
        val r = repo.profile(force = true)
        assertEquals(0, notified) // DO NOT fire the re-login dialog on a network blip
        assertTrue(r is ApiResult.Error && r.type == ErrorType.NETWORK)
    }

    @Test
    fun `non-retryable 401 does not refresh`() = runBlocking {
        var notified = 0
        var refreshAttempts = 0
        val api = FakeApi().apply {
            markKehadiranStub = { throw ApiHttpException(401, "expired") }
        }
        val repo = SsoRepository(
            api,
            onSessionExpired = { notified++ },
            tokenStore = FakeTokenStore(),
            refreshToken = { refreshAttempts++; "new-jwt" },
        )
        val r = repo.markKehadiran("qr") // upstream-scraped POST: stale, not dead-JWT
        assertEquals(1, notified)
        assertEquals(0, refreshAttempts) // POST never refreshes
        assertTrue(r is ApiResult.Error && r.type == ErrorType.STALE_SESSION)
    }

    @Test
    fun `concurrent 401s trigger only one refresh POST`() = runBlocking {
        var refreshCalls = 0
        var calls = 0
        val api = FakeApi().apply {
            profileStub = {
                calls++
                if (calls == 1) throw ApiHttpException(401, "expired")
                SiapProfile(nama = "OK", nim = "2404")
            }
        }
        val store = FakeTokenStore()
        val repo = SsoRepository(
            api,
            tokenStore = store,
            refreshToken = {
                refreshCalls++
                delay(50) // make concurrent callers overlap on the shared refresh
                "new-jwt"
            },
        )
        val (r1, r2) =
            coroutineScope {
                val a = async { repo.profile(force = true) }
                val b = async { repo.profile(force = true) }
                a.await() to b.await()
            }
        assertTrue(r1 is ApiResult.Success || r2 is ApiResult.Success)
        assertEquals(1, refreshCalls)
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
