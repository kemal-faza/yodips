package ac.undip.sso.core.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Backend base URL. On the Android emulator, `10.0.2.2` is the host machine's
 * loopback — so the dev backend at localhost:3000 is reached as 10.0.2.2:3000.
 * Override via a BuildConfig field in a real build if the backend is remote.
 */
object ApiClient {
    const val BASE_URL = "http://10.0.2.2:3000"

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    // Long timeouts: the handoff can involve upstream SSO/Kulon/SIAP round-trips.
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * POST /api/auth/session/handoff with the captured session cookies. The
     * backend validates the Kulon session, derives the NIM, and issues a JWT.
     *
     * @param siapCookie   raw `sia_app_session=...` header value, if captured
     * @param kulonCookie  raw `MoodleSession=...` header value, if captured
     */
    suspend fun handoff(siapCookie: String?, kulonCookie: String?): HandoffResult {
        val body = buildString {
            append("{")
            append("\"capturedAt\":").append(System.currentTimeMillis() / 1000)
            if (siapCookie != null) append(",\"siapCookie\":").append(jsonEscape(siapCookie))
            if (kulonCookie != null) append(",\"kulonCookie\":").append(jsonEscape(kulonCookie))
            append("}")
        }
        val req = Request.Builder()
            .url("$BASE_URL/api/auth/session/handoff")
            .post(body.toRequestBody(jsonMedia))
            .header("Content-Type", "application/json")
            .build()

        return try {
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

    private fun jsonEscape(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"")
}
