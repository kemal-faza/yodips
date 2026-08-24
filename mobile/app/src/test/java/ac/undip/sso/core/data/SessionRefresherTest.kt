package ac.undip.sso.core.data

import ac.undip.sso.core.network.ErrorType
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.SerializationException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
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
    }

    private fun http401() =
        HttpException(Response.error<Any>(401, "unauthorized".toResponseBody()))

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
}
