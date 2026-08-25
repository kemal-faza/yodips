package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KtorSsoApiTest {
    private fun mockClient(
        status: HttpStatusCode = HttpStatusCode.OK,
        body: String = "",
        assertRequest: suspend (io.ktor.client.request.HttpRequestData) -> Unit = {},
    ): HttpClient =
        HttpClient(MockEngine) {
            engine {
                addHandler { request ->
                    assertEquals("Bearer test-jwt", request.headers[HttpHeaders.Authorization])
                    assertRequest(request)
                    respond(ByteReadChannel(body), status)
                }
            }
        }

    private fun api(client: HttpClient): KtorSsoApi =
        KtorSsoApi(client, baseUrl = "https://be.test/", authTokenProvider = { "test-jwt" })

    @Test
    fun `profile parses envelope-free DTO`() = runBlocking {
        val p = api(mockClient(body = """{"nama":"Ana","nim":"2404"}""")).profile()
        assertEquals("Ana", p.nama)
        assertEquals("2404", p.nim)
    }

    @Test(expected = ApiHttpException::class)
    fun `401 throws ApiHttpException with status`() = runBlocking {
        api(
            mockClient(
                status = HttpStatusCode.Unauthorized,
                body = """{"code":"SESSION_DEAD"}""",
            ),
        ).profile()
    }

    @Test
    fun `markKehadiran posts json body and parses response`() = runBlocking {
        var ctype = ""
        val resp = api(
            mockClient(
                body = """{"status":"OK"}""",
                assertRequest = { ctype = it.headers[HttpHeaders.ContentType].orEmpty() },
            ),
        ).markKehadiran(KehadiranRequest(token = "qr-token-xyz"))
        assertTrue("content-type json", ctype.startsWith("application/json"))
        assertEquals("OK", resp.status)
    }

    @Test
    fun `unregisterPushDevice sends DELETE with body`() = runBlocking {
        var method = ""
        var ctype = ""
        val resp = api(
            mockClient(
                body = """{"ok":true}""",
                assertRequest = {
                    method = it.method.value
                    ctype = it.headers[HttpHeaders.ContentType].orEmpty()
                },
            ),
        ).unregisterPushDevice(PushDeviceRequest(token = "fcm-token-abc"))
        assertEquals("DELETE", method)
        assertTrue("content-type json", ctype.startsWith("application/json"))
        assertEquals(true, resp.ok)
    }

    @Test
    fun `assignments decodes list with unknown fields ignored`() = runBlocking {
        val list = api(
            mockClient(
                body = """[{"id":42,"name":"Tugas 1","module":"assign","extraField":"should be ignored","duedate":1700000000,"overdue":false,"course":"Matematika","courseId":5,"assignmentId":42,"courseModuleId":7}]""",
            ),
        ).assignments()
        assertEquals(1, list.size)
        assertEquals("Tugas 1", list[0].name)
        assertEquals(42L, list[0].id)
    }
}
