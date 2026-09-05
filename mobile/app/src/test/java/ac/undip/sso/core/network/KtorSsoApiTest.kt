package ac.undip.sso.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
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
            defaultRequest {
                header(HttpHeaders.Authorization, "Bearer test-jwt")
            }
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
    fun `401 throws ApiHttpException with status`() {
        runBlocking {
            api(
                mockClient(
                    status = HttpStatusCode.Unauthorized,
                    body = """{"code":"SESSION_DEAD"}""",
                ),
            ).profile()
        }
    }

    @Test
    fun `markKehadiran posts json body and parses response`() = runBlocking {
        val resp = api(
            mockClient(
                body = """{"status":"OK"}""",
                assertRequest = { req ->
                    assertEquals("POST", req.method.value)
                    assertTrue("content-type present",
                        req.body.contentType != null &&
                        req.body.contentType.toString().startsWith("application/json"))
                },
            ),
        ).markKehadiran(KehadiranRequest(token = "qr-token-xyz"))
        assertEquals("OK", resp.status)
    }

    @Test
    fun `unregisterPushDevice sends DELETE with body`() = runBlocking {
        val resp = api(
            mockClient(
                body = """{"ok":true}""",
                assertRequest = { req ->
                    assertEquals("DELETE", req.method.value)
                    assertTrue("content-type present",
                        req.body.contentType != null &&
                        req.body.contentType.toString().startsWith("application/json"))
                },
            ),
        ).unregisterPushDevice(PushDeviceRequest(token = "fcm-token-abc"))
        assertEquals(true, resp.ok)
    }

    @Test
    fun `registerWebPushDevice posts web subscription and parses ok`() = runBlocking {
        val resp = api(
            mockClient(
                body = """{"ok":true}""",
                assertRequest = { req ->
                    assertEquals("POST", req.method.value)
                    assertEquals("/api/notifications/web-device", req.url.encodedPath)
                    assertTrue("content-type present",
                        req.body.contentType != null &&
                        req.body.contentType.toString().startsWith("application/json"))
                    val bytes = (req.body as io.ktor.http.content.OutgoingContent.ByteArrayContent).bytes()
                    val sent = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
                        .decodeFromString<WebPushDeviceRequest>(bytes.decodeToString())
                    assertEquals("https://push.example/abc", sent.endpoint)
                    assertEquals("BASE64URL_P256DH", sent.p256dh)
                    assertEquals("BASE64URL_AUTH", sent.auth)
                },
            ),
        ).registerWebPushDevice(
            WebPushDeviceRequest(
                endpoint = "https://push.example/abc",
                p256dh = "BASE64URL_P256DH",
                auth = "BASE64URL_AUTH",
            ),
        )
        assertEquals(true, resp.ok)
    }

    @Test
    fun `unregisterWebPushDevice sends DELETE with subscription body`() = runBlocking {
        val resp = api(
            mockClient(
                body = """{"ok":true}""",
                assertRequest = { req ->
                    assertEquals("DELETE", req.method.value)
                    assertEquals("/api/notifications/web-device", req.url.encodedPath)
                    assertTrue("content-type present",
                        req.body.contentType != null &&
                        req.body.contentType.toString().startsWith("application/json"))
                },
            ),
        ).unregisterWebPushDevice(WebPushDeviceRequest(endpoint = "https://push.example/abc"))
        assertEquals(true, resp.ok)
    }

    @Test
    fun `vapidPublicKey parses public key`() = runBlocking {
        val v = api(
            mockClient(
                body = """{"publicKey":"BEl62_VAPID_KEY_DUMMY"}""",
                assertRequest = { req ->
                    assertEquals("GET", req.method.value)
                    assertEquals("/api/notifications/vapid-public-key", req.url.encodedPath)
                },
            ),
        ).vapidPublicKey()
        assertEquals("BEl62_VAPID_KEY_DUMMY", v.publicKey)
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

    @Test
    fun `assignmentDetail requests cmid query and parses nested submission`() = runBlocking {
        val d = api(
            mockClient(
                body = """{
                    "assignmentId": 42,
                    "name": "Tugas 1",
                    "descriptionHtml": "<p>Deskripsi</p>",
                    "descriptionMarkdown": "Deskripsi",
                    "files": [{"name":"Berkas.pdf","url":"https://kulon/pluginfile.php/1"}],
                    "submission": {"status":"submitted","submittedAt":1700000000,"grade":null,"maxGrade":100},
                    "kulonUrl": "https://kulon2.undip.ac.id/mod/assign/view.php?id=7"
                }""",
                assertRequest = { req ->
                    assertEquals("GET", req.method.value)
                    assertEquals("7", req.url.parameters["cmid"])
                    assertEquals("/api/kulon/assignments/42/detail", req.url.encodedPath)
                },
            ),
        ).assignmentDetail(assignmentId = 42, cmid = 7)
        assertEquals("Tugas 1", d.name)
        assertEquals(1, d.files.size)
        assertEquals("Berkas.pdf", d.files[0].name)
        assertEquals("submitted", d.submission.status)
        assertEquals("Deskripsi", d.descriptionMarkdown)
    }

    @Test
    fun `courseContent hits the content endpoint and parses DTO`() = runBlocking {
        val body =
            """{"courseId":16294,"sections":[{"id":1,"label":"Pertemuan 1","items":[{"kind":"file","name":"S1","url":"https://k/f","fileType":"pdf","cmid":10}]}]}"""
        val resp =
            api(
                mockClient(
                    body = body,
                    assertRequest = { req ->
                        assertEquals("https://be.test/api/kulon/courses/16294/content", req.url.toString())
                    },
                ),
            ).courseContent(16294)
        assertEquals(16294L, resp.courseId)
        assertEquals("Pertemuan 1", resp.sections[0].label)
    }

    @Test
    fun `logout posts to auth logout and parses ok`() = runBlocking {
        val resp = api(
            mockClient(
                body = """{"ok":true}""",
                assertRequest = { req ->
                    assertEquals("POST", req.method.value)
                    assertEquals("/api/auth/logout", req.url.encodedPath)
                    assertTrue(
                        "content-type present",
                        req.body.contentType != null &&
                            req.body.contentType.toString().startsWith("application/json"),
                    )
                },
            ),
        ).logout()
        assertEquals(true, resp.ok)
    }

    @Test(expected = ApiHttpException::class)
    fun `logout non-2xx throws ApiHttpException`() {
        runBlocking {
            api(mockClient(status = HttpStatusCode.InternalServerError, body = """{"message":"down"}"""))
                .logout()
        }
    }
}
