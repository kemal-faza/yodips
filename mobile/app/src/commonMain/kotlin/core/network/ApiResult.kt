package ac.undip.sso.core.network

/**
 * Sealed result, mirroring the web `ApiResult` contract (§6 mobile spec).
 * Every data call from a ViewModel flows through this so screens can clamp to
 * four states: Loading / Empty / Error / Content.
 */
sealed class ApiResult<out T> {
    data class Success<T>(
        val data: T,
    ) : ApiResult<T>()

    data class Error(
        val code: Int? = null,
        val message: String,
        val type: ErrorType,
    ) : ApiResult<Nothing>()
}

/** Coarse error taxonomy consumed by the UI + auth layers. */
enum class ErrorType {
    NETWORK, // connectivity / DNS / timeout — retryable, not session-related
    UNAUTHORIZED, // auth-level 401; global re-login requires the SESSION_DEAD code
    STALE_SESSION, // service-level 401 (upstream Kulon/SIAP session died) → re-auth
    RECOVERY_UNSUPPORTED, // show a user-directed platform action; retain session
    NOT_FOUND,
    SERVER, // 5xx or unexpected upstream/parsing failure
    UPSTREAM, // a real (non-session) business error surfaced by an upstream service
}
