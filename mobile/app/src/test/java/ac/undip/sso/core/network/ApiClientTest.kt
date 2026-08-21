package ac.undip.sso.core.network

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `refresh returns the new JWT on 200`() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"accessToken":"new-jwt"}"""),
        )
        // refresh(baseUrl) lets the test point at the MockWebServer instead of
        // the hardcoded production BASE_URL.
        val token = ApiClient.refresh(baseUrl = server.url("/").toString())
        assertEquals("new-jwt", token)
    }

    @Test
    fun `refresh throws on 401`() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"code":"SESSION_DEAD"}"""),
        )
        val threw = runCatching { ApiClient.refresh(baseUrl = server.url("/").toString()) }.isFailure
        assertTrue(threw)
    }
}