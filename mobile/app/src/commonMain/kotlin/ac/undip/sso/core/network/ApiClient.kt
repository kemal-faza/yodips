package ac.undip.sso.core.network

import ac.undip.sso.appBaseUrl
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Backend base URL, baked per buildType in app/build.gradle.kts:
 * debug → emulator loopback (local backend, cleartext via the debug
 * network_security_config); release → production HTTPS backend.
 */
object ApiClient {
    val BASE_URL = appBaseUrl
    private val API_BASE = "$BASE_URL/"

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    /** Latest JWT — set by the login flow after handoff / cleared on logout. */
    @Volatile var authToken: String? = null

    // Lenient so unknown/optional upstream fields never crash data screens.
    private val apiJson =
        Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            isLenient = true
        }

    // Long timeouts: the handoff can involve upstream SSO/Kulon/SIAP round-trips.
    private val client =
        OkHttpClient
            .Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            // Certificate pinning: the backend host is fixed, so a CA compromise
            // cannot MITM the JWT handoff. Pins are the SPKI SHA-256 of the leaf
            // (crunchy.my.id) and its GTS WE1 intermediate (the resilient backup
            // that survives a leaf rotation without an app update).
            .certificatePinner(
                CertificatePinner
                    .Builder()
                    .add(
                        "backend.crunchy.my.id",
                        "sha256/kQsdoAmDUNHVpLtovFJwVA6FYPpS1/IdstEYLYBX5+U=",
                        "sha256/kIdp6NNEd8wsugYyyIYFsi1ylMCED3hZbSR8ZFsa/A4=",
                    ).build(),
            )
            .build()

    /**
     * POST /api/auth/session/handoff with the captured session cookies. The
     * backend validates the Kulon session, derives the NIM, and issues a JWT.
     *
     * @param siapCookie   raw `sia_app_session=...` header value, if captured
     * @param kulonCookie  raw `MoodleSession=...` header value, if captured
     */
    suspend fun handoff(
        siapCookie: String?,
        kulonCookie: String?,
    ): HandoffResult {
        val body = handoffBody(siapCookie, kulonCookie)
        val req =
            Request
                .Builder()
                .url("$BASE_URL/api/auth/session/handoff")
                .post(body.toRequestBody(jsonMedia))
                .header("Content-Type", "application/json")
                .build()

        return withContext(Dispatchers.IO) {
            try {
                client.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    if (resp.isSuccessful) {
                        try {
                            val parsed = SIAP_JSON.decodeFromString<HandoffResponse>(text)
                            HandoffResult.Success(parsed.accessToken)
                        } catch (e: Exception) {
                            HandoffResult.Failure("Respons handoff tidak valid: ${e.message}")
                        }
                    } else {
                        HandoffResult.Failure("Handoff gagal (HTTP ${resp.code}): ${text.take(200)}")
                    }
                }
            } catch (e: IOException) {
                HandoffResult.Failure("Tidak dapat terhubung ke server: ${e.message}")
            }
        }
    }

    /**
     * POST /api/auth/refresh with the current (possibly expired) JWT. Returns
     * the new JWT. Throws [retrofit2.HttpException] on 401 (SESSION_DEAD /
     * INVALID_TOKEN) and [java.io.IOException] on network failure.
     */
    suspend fun refresh(baseUrl: String = BASE_URL): String {
        val req =
            Request
                .Builder()
                .url("$baseUrl/api/auth/refresh")
                .post(ByteArray(0).toRequestBody(null))
                .header("Authorization", "Bearer ${authToken ?: ""}")
                .build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) {
                throw HttpException(
                    Response.error<Any>(res.code, res.body ?: "".toResponseBody(null)),
                )
            }
            val body = res.body?.string().orEmpty()
            val parsed = apiJson.decodeFromString<RefreshResponse>(body)
            return parsed.accessToken
        }
    }

    /**
     * Retrofit-backed client for the JWT-guarded data routes. The OkHttp
     * interceptor injects `Authorization: Bearer <authToken>` so callers do not
     * attach the header themselves.
     */
    val api: SsoApi by lazy {
        val http =
            client
                .newBuilder()
                .addInterceptor { chain ->
                    val t = authToken
                    val request =
                        if (t.isNullOrBlank()) {
                            chain.request()
                        } else {
                            chain
                                .request()
                                .newBuilder()
                                .header("Authorization", "Bearer $t")
                                .build()
                        }
                    chain.proceed(request)
                }.build()
        Retrofit
            .Builder()
            .baseUrl(API_BASE)
            .client(http)
            .addConverterFactory(apiJson.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(SsoApi::class.java)
    }
}

@kotlinx.serialization.Serializable
internal data class RefreshResponse(val accessToken: String)
