package ac.undip.sso.core.network

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
    data class Success(val token: String) : HandoffResult
    data class Failure(val reason: String) : HandoffResult
}

/** Value todo: always JSON, no comments. */
val SIAP_JSON = Json { ignoreUnknownKeys = true }
