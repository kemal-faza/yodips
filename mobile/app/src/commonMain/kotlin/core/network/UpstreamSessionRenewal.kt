package ac.undip.sso.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class UpstreamSessionService {
    @SerialName("kulon") KULON,
    @SerialName("siap") SIAP,
}

@Serializable
data class UpstreamSessionRenewalRequest(
    val service: UpstreamSessionService,
    val cookie: String,
)

@Serializable
data class UpstreamSessionRenewalResponse(
    val service: UpstreamSessionService,
    val status: String,
)

/** Contract codes only; response bodies, cookies, and upstream messages stay private. */
enum class RenewalContractFailure {
    SESSION_DEAD,
    AUTH_REJECTED,
    UPSTREAM_SESSION_INVALID,
    UPSTREAM_SESSION_CONFLICT,
    UPSTREAM_UNAVAILABLE,
    UNSUPPORTED,
    NETWORK_FAILURE,
}

class UpstreamSessionRenewalException(
    val failure: RenewalContractFailure,
) : Exception()

/** Narrow transport seam used by [ac.undip.sso.core.data.SessionRecoveryCoordinator]. */
fun interface UpstreamSessionRenewal {
    suspend fun renewUpstreamSession(
        service: UpstreamSessionService,
        cookie: String,
    ): UpstreamSessionRenewalResponse
}
