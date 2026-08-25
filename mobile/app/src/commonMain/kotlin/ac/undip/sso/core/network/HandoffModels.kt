package ac.undip.sso.core.network

import ac.undip.sso.nowMs
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** POST /api/auth/session/handoff response (issues the JWT). */
@Serializable
data class HandoffResponse(
    @SerialName("accessToken") val accessToken: String,
    @SerialName("capturedAt") val capturedAt: Long = 0,
) {
    @SerialName("message")
    val message: String? = null
}

/** Result object of a handoff attempt. */
sealed interface HandoffResult {
    data class Success(
        val token: String,
    ) : HandoffResult

    data class Failure(
        val reason: String,
    ) : HandoffResult
}

/** Value todo: always JSON, no comments. */
val SIAP_JSON = Json { ignoreUnknownKeys = true }

private fun jsonEscape(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")

/**
 * Build the `POST /api/auth/session/handoff` JSON body. Each cookie value is a
 * JSON STRING literal (surrounded by quotes + escaped) — the handoff endpoint
 * expects `siapCookie`/`kulonCookie` to be raw cookie-HEADER strings.
 */
fun handoffBody(
    siapCookie: String?,
    kulonCookie: String?,
): String =
    buildString {
        append("{")
        append("\"capturedAt\":").append(nowMs() / 1000)
        if (siapCookie != null) {
            append(",\"siapCookie\":\"").append(jsonEscape(siapCookie)).append("\"")
        }
        if (kulonCookie != null) {
            append(",\"kulonCookie\":\"").append(jsonEscape(kulonCookie)).append("\"")
        }
        append("}")
    }
