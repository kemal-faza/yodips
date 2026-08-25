package ac.undip.sso.core.network

import ac.undip.sso.appBaseUrl
import io.ktor.client.HttpClient
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json

/**
 * Singleton holding the network stack for the backend API.
 */
object Backend {
    val BASE_URL: String = appBaseUrl
    private val API_BASE = "$BASE_URL/"

    @Volatile var authToken: String? = null

    val apiJson = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

    val api: SsoApi by lazy {
        KtorSsoApi(
            createPlatformClient {
                defaultRequest {
                    header(HttpHeaders.Authorization, "Bearer ${authToken?.orEmpty()}")
                }
            },
            baseUrl = API_BASE,
            authTokenProvider = { authToken },
        )
    }

    /**
     * POST /api/auth/refresh. Throws [ApiHttpException] on non-2xx.
     */
    suspend fun refresh(baseUrl: String = BASE_URL): String {
        val client = createPlatformClient()
        try {
            val resp: HttpResponse = client.post("$baseUrl/api/auth/refresh") {
                setBody(ByteArray(0))
                header(HttpHeaders.Authorization, "Bearer ${authToken ?: ""}")
                contentType(ContentType.Application.Json)
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) {
                throw ApiHttpException(resp.status.value, text.take(200))
            }
            return apiJson.decodeFromString<RefreshResponse>(text).accessToken
        } finally {
            client.close()
        }
    }

    /**
     * POST /api/auth/session/handoff.
     */
    suspend fun handoff(
        siapCookie: String?,
        kulonCookie: String?,
    ): HandoffResult {
        val body = handoffBody(siapCookie, kulonCookie)
        val client = createPlatformClient()
        return try {
            val resp: HttpResponse = client.post("$BASE_URL/api/auth/session/handoff") {
                setBody(body)
                contentType(ContentType.Application.Json)
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) {
                return HandoffResult.Failure("Handoff gagal (HTTP ${resp.status.value}): ${text.take(200)}")
            }
            try {
                val parsed = SIAP_JSON.decodeFromString<HandoffResponse>(text)
                HandoffResult.Success(parsed.accessToken)
            } catch (e: Exception) {
                HandoffResult.Failure("Respons handoff tidak valid: ${e.message}")
            }
        } catch (e: Exception) {
            HandoffResult.Failure("Tidak dapat terhubung ke server: ${e.message}")
        } finally {
            client.close()
        }
    }
}
