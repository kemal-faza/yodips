package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.ErrorType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException

/** HTTP status → coarse [ErrorType] for every non-401 backend failure. */
fun typeForHttp(code: Int): ErrorType =
    when (code) {
        401 -> ErrorType.UNAUTHORIZED
        404 -> ErrorType.NOT_FOUND
        in 400..499 -> ErrorType.UPSTREAM
        else -> ErrorType.SERVER
    }

/**
 * Session refresh + error taxonomy, extracted from SsoRepository so the
 * taxonomy is reusable by push/session paths and refresh single-flight is
 * testable without cache machinery.
 *
 * Maps every suspend block into [ApiResult]. On a retryable 401 it triggers a
 * SINGLE-FLIGHT refresh — N concurrent 401s issue exactly ONE refresh POST.
 * On dead session [onSessionExpired] fires (universal re-login dialog); on a
 * network failure no dialog fires (server down != dead session).
 */
class SessionRefresher(
    private val scope: CoroutineScope,
    private val refreshToken: suspend () -> String,
    private val tokenStore: TokenStoreLike?,
    private val onSessionExpired: () -> Unit,
) {
    enum class RefreshResult { SUCCESS, DEAD_SESSION, NETWORK_FAILURE }

    private var inflightRefresh: Deferred<RefreshResult>? = null

    /**
     * Single-flight refresh: concurrent 401s share one in-flight refresh (a shared
     * Deferred), so N parallel 401s issue exactly ONE refresh POST. Returns the
     * outcome so the caller can distinguish a genuinely dead session (dialog)
     * from a network blip (no dialog).
     */
    suspend fun tryRefresh(): RefreshResult {
        inflightRefresh?.let { return it.await() }
        val deferred = scope.async {
            try {
                val newJwt = refreshToken()
                Backend.authToken = newJwt
                val siap = tokenStore?.let { runCatching { it.siapCookie.first() }.getOrNull() }
                val kulon = tokenStore?.let { runCatching { it.kulonCookie.first() }.getOrNull() }
                tokenStore?.save(newJwt, siap, kulon)
                RefreshResult.SUCCESS
            } catch (e: ApiHttpException) {
                RefreshResult.DEAD_SESSION // 401 SESSION_DEAD / INVALID_TOKEN
            } catch (e: Exception) {
                RefreshResult.NETWORK_FAILURE // do NOT fire the dialog (wasmJs has no IOException)
            }
        }
        inflightRefresh = deferred
        return try {
            deferred.await()
        } finally {
            if (inflightRefresh === deferred) inflightRefresh = null
        }
    }

    /**
     * Maps every backend call into [ApiResult] (see [ErrorType]). On 401:
     * - If !retryable (POST path like markKehadiran): fires onSessionExpired
     *   immediately, no refresh attempted.
     * - If retryable: single-flight refresh, then retries block() once.
     *
     * [serviceStale] marks calls whose data is scraped from Kulon/SIAP with the
     * user's stored cookies: their 401 means the UPSTREAM session died while
     * the JWT may still be valid, so the precise [ErrorType.STALE_SESSION] is
     * surfaced (the re-login dialog signal is identical either way).
     */
    suspend fun <T> safe(
        retryable: Boolean = true,
        serviceStale: Boolean = false,
        block: suspend () -> T,
    ): ApiResult<T> {
        val staleType = if (serviceStale) ErrorType.STALE_SESSION else ErrorType.UNAUTHORIZED
        return try {
            ApiResult.Success(block())
        } catch (e: ApiHttpException) {
            if (e.status == 401) {
                if (!retryable) {
                    onSessionExpired()
                    return ApiResult.Error(e.status, e.message, staleType)
                }
                when (tryRefresh()) {
                    RefreshResult.SUCCESS -> {
                        try {
                            ApiResult.Success(block())
                        } catch (e2: ApiHttpException) {
                            val t = typeForHttp(e2.status)
                            if (t == ErrorType.UNAUTHORIZED) onSessionExpired()
                            ApiResult.Error(e2.status, e2.message, t)
                        }
                    }
                    RefreshResult.DEAD_SESSION -> {
                        onSessionExpired()
                        ApiResult.Error(e.status, e.message, staleType)
                    }
                    RefreshResult.NETWORK_FAILURE -> {
                        ApiResult.Error(null, "Tidak dapat terhubung ke server", ErrorType.NETWORK)
                    }
                }
            } else {
                ApiResult.Error(e.status, e.message, typeForHttp(e.status))
            }
        } catch (e: SerializationException) {
            ApiResult.Error(null, "Respons tidak dapat dibaca", ErrorType.SERVER)
        } catch (e: Exception) {
            // Network or generic error.
            // IOException is JVM-only; wasmJs uses Exception for network failures.
            if (e is ApiHttpException) {
                val t = typeForHttp(e.status)
                if (t == ErrorType.UNAUTHORIZED) onSessionExpired()
                ApiResult.Error(e.status, e.message, t)
            } else {
                val msg = e.message ?: "Terjadi kesalahan"
                // Type hint: NETWORK for IOException-like messages, SERVER otherwise.
                val isNetwork = msg.contains("connect", ignoreCase = true) ||
                    msg.contains("ECONN", ignoreCase = true) ||
                    msg.contains("timeout", ignoreCase = true) ||
                    msg.contains("network", ignoreCase = true) ||
                    msg.contains("resolve", ignoreCase = true)
                ApiResult.Error(null, msg, if (isNetwork) ErrorType.NETWORK else ErrorType.SERVER)
            }
        }
    }
}
