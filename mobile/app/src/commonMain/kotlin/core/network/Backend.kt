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
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Singleton holding the network stack for the backend API.
 */
object Backend {
    val BASE_URL: String = appBaseUrl
    private val API_BASE = "$BASE_URL/"

    @kotlin.concurrent.Volatile var authToken: String? = null

    val apiJson = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
    }

    @kotlinx.serialization.Serializable
    private data class RefreshResponse(val accessToken: String)

    val api: SsoApi by lazy {
        KtorSsoApi(
            createPlatformClient {
                defaultRequest {
                    header(HttpHeaders.Authorization, "Bearer ${authToken?.orEmpty()}")
                }
            },
            baseUrl = API_BASE,
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
        ssoCookie: String? = null,
    ): HandoffResult {
        val body = handoffBody(siapCookie, kulonCookie, ssoCookie)
        val client = createPlatformClient()
        return try {
            val resp: HttpResponse = client.post("$BASE_URL/api/auth/session/handoff") {
                setBody(body)
                contentType(ContentType.Application.Json)
            }
            val text = resp.bodyAsText()
            if (!resp.status.isSuccess()) {
                // Only the contract code crosses the boundary; the response
                // body and the HTTP status never become user copy.
                val code = errorCode(text)
                return HandoffResult.Failure(
                    UserMessages.forError(ErrorType.SERVER, resp.status.value, code),
                )
            }
            try {
                val parsed = SIAP_JSON.decodeFromString<HandoffResponse>(text)
                HandoffResult.Success(parsed.accessToken)
            } catch (_: Exception) {
                HandoffResult.Failure(UserMessages.UNPARSEABLE)
            }
        } catch (_: Exception) {
            HandoffResult.Failure(UserMessages.NETWORK)
        } finally {
            client.close()
        }
    }
}

/**
 * Best-effort `{ code }` lift from an error body. Anything unparsable (proxy
 * HTML, empty body, gateway page) yields null and the caller maps by status.
 */
private fun errorCode(text: String): String? =
    runCatching {
        Backend.apiJson
            .parseToJsonElement(text)
            .jsonObject["code"]
            ?.jsonPrimitive
            ?.contentOrNull
    }.getOrNull()
