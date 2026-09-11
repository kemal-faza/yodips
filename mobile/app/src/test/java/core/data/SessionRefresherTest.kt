package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.ErrorType
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** Session refresh + error taxonomy, split out of SsoRepository (one concern per class). */
class SessionRefresherTest {
    private class FakeStore : TokenStoreLike {
        var saved: Triple<String, String?, String?>? = null
        override val siapCookie: Flow<String?> = flowOf("siap-c")
        override val kulonCookie: Flow<String?> = flowOf("kulon-c")
        override suspend fun save(token: String, siap: String?, kulon: String?) {
            saved = Triple(token, siap, kulon)
        }
        override suspend fun currentToken(): String? = saved?.first
        override suspend fun clear() { saved = null }
    }

    private fun http401() = ApiHttpException(401, "unauthorized")

    @Test
    fun `concurrent 401s share one in-flight refresh`() = runTest {
        var calls = 0
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = {
                calls += 1
                kotlinx.coroutines.delay(100) // widen the race window
                "new-jwt"
            },
            tokenStore = FakeStore(),
            onSessionExpired = {},
        )
        val results = coroutineScope {
            (1..5).map { async { refresher.tryRefresh() } }.awaitAll()
        }
        assertEquals(1, calls)
        assertTrue(results.all { it == SessionRefresher.RefreshResult.SUCCESS })
    }

    @Test
    fun `refresh 401 maps to DEAD_SESSION and fires no dialog by itself`() = runTest {
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = { throw http401() },
            tokenStore = null,
            onSessionExpired = {},
        )
        assertEquals(
            SessionRefresher.RefreshResult.DEAD_SESSION,
            refresher.tryRefresh(),
        )
    }

    @Test
    fun `network failure maps to NETWORK_FAILURE (no dead-session dialog)`() = runTest {
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = { throw IOException("airplane mode") },
            tokenStore = null,
            onSessionExpired = {},
        )
        assertEquals(
            SessionRefresher.RefreshResult.NETWORK_FAILURE,
            refresher.tryRefresh(),
        )
    }

    // RED (fix relogin-loop): refresh endpoint yang 429/5xx BUKAN bukti sesi
    // mati — hanya 401 (SESSION_DEAD/INVALID_TOKEN) yang boleh dianggap dead.
    @Test
    fun `refresh 5xx maps to NETWORK_FAILURE, not DEAD_SESSION`() = runTest {
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = { throw ApiHttpException(500, "server error") },
            tokenStore = null,
            onSessionExpired = {},
        )
        assertEquals(
            SessionRefresher.RefreshResult.NETWORK_FAILURE,
            refresher.tryRefresh(),
        )
    }

    @Test
    fun `refresh 429 maps to NETWORK_FAILURE, not DEAD_SESSION`() = runTest {
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = { throw ApiHttpException(429, "too many requests") },
            tokenStore = null,
            onSessionExpired = {},
        )
        assertEquals(
            SessionRefresher.RefreshResult.NETWORK_FAILURE,
            refresher.tryRefresh(),
        )
    }

    @Test
    fun `successful refresh rotates the stored token with current cookies`() = runTest {
        val store = FakeStore()
        val refresher = SessionRefresher(
            scope = backgroundScope,
            refreshToken = { "rotated-jwt" },
            tokenStore = store,
            onSessionExpired = {},
        )
        refresher.tryRefresh()
        assertEquals(Triple("rotated-jwt", "siap-c", "kulon-c"), store.saved)
    }

    @Test
    fun `http status to ErrorType mapping is reusable`() {
        // Covered end-to-end by SsoRepositoryTest through the facade; here we
        // pin the reusable mapping itself (push/session paths may reuse it).
        assertEquals(ErrorType.UNAUTHORIZED, typeForHttp(401))
        assertEquals(ErrorType.NOT_FOUND, typeForHttp(404))
        assertEquals(ErrorType.UPSTREAM, typeForHttp(422))
        assertEquals(ErrorType.SERVER, typeForHttp(500))
    }

    // ---------- safe(): dialog policy (fix relogin-loop) ----------

    private fun refresher(
        scope: kotlinx.coroutines.CoroutineScope,
        refreshToken: suspend () -> String,
        onSessionExpired: () -> Unit,
    ) = SessionRefresher(
        scope = scope,
        refreshToken = refreshToken,
        tokenStore = null,
        onSessionExpired = onSessionExpired,
    )

    // JWT segar (refresh sukses) PASTI lolos JwtAuthGuard — 401 pada retry
    // berarti upstream stale (SIAP/Kulon), bukan sesi backend mati. Harus
    // jadi error per-layar STALE_SESSION TANPA memaksa popup login ulang.
    @Test
    fun `serviceStale retry 401 maps to STALE_SESSION and fires no dialog`() = runTest {
        var dialogs = 0
        val r = refresher(backgroundScope, { "fresh-jwt" }, { dialogs++ })
        var calls = 0
        val result = r.safe(serviceStale = true) {
            calls += 1
            throw ApiHttpException(401, "SIAP session belum ada. Silakan login ulang via SSO")
        }
        assertTrue(result is ApiResult.Error)
        assertEquals(ErrorType.STALE_SESSION, (result as ApiResult.Error).type)
        assertEquals(2, calls) // 401 → refresh sukses → retry
        assertEquals(0, dialogs)
    }

    // markKehadiran (retryable=false, serviceStale=true): 401 upstream-stale
    // tidak boleh memaksa logout; cukup error per-layar.
    @Test
    fun `non-retryable serviceStale 401 fires no dialog`() = runTest {
        var dialogs = 0
        val r = refresher(backgroundScope, { "fresh-jwt" }, { dialogs++ })
        val result = r.safe(retryable = false, serviceStale = true) { throw http401() }
        assertTrue(result is ApiResult.Error)
        assertEquals(ErrorType.STALE_SESSION, (result as ApiResult.Error).type)
        assertEquals(0, dialogs)
    }

    // Endpoint yang TIDAK menyentuh upstream (mis. register push): 401 setelah
    // refresh sukses = sesi backend benar-benar bermasalah → dialog tetap.
    @Test
    fun `non-serviceStale retry 401 still fires the dialog`() = runTest {
        var dialogs = 0
        val r = refresher(backgroundScope, { "fresh-jwt" }, { dialogs++ })
        val result = r.safe(serviceStale = false) { throw http401() }
        assertTrue(result is ApiResult.Error)
        assertEquals(1, dialogs)
    }

    // Refresh yang gagal 401 (SESSION_DEAD — backend kehilangan record sesi)
    // tetap memicu dialog: ini satu-satunya kondisi yang hanya bisa diperbaiki
    // dengan login ulang penuh.
    @Test
    fun `refresh DEAD_SESSION still fires the dialog`() = runTest {
        var dialogs = 0
        val r = refresher(
            backgroundScope,
            { throw ApiHttpException(401, "SESSION_DEAD") },
            { dialogs++ },
        )
        val result = r.safe(serviceStale = true) { throw http401() }
        assertTrue(result is ApiResult.Error)
        assertEquals(1, dialogs)
    }
}
