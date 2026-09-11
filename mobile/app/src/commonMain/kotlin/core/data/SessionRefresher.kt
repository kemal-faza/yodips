package ac.undip.sso.core.data

import ac.undip.sso.core.network.ApiHttpException
import ac.undip.sso.core.network.ApiResult
import ac.undip.sso.core.network.Backend
import ac.undip.sso.core.network.ErrorType
import ac.undip.sso.core.network.isServiceStaleCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
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
 * SINGLE-FLIGHT refresh via the shared [SessionFlight] primitive (ADR-0003) —
 * N concurrent 401s issue exactly ONE refresh POST, with one kotlinx-Mutex
 * race policy instead of the previous unsynchronized raw Deferred.
 * On dead session [onSessionExpired] fires (universal re-login dialog); on a
 * network failure no dialog fires (server down != dead session).
 *
 * STALE CLASSIFICATION: a 401 is "upstream stale" when its call site sets
 * [serviceStale] (a scraper route) OR the backend envelope carried a
 * [SERVICE_STALE_CODES] code. The code fallback is the contract-driven half of
 * candidate #5 — it does not depend on the route flag staying in sync.
 */
class SessionRefresher(
    private val scope: CoroutineScope,
    private val refreshToken: suspend () -> String,
    private val tokenStore: TokenStoreLike?,
    private val onSessionExpired: () -> Unit,
) {
    enum class RefreshResult { SUCCESS, DEAD_SESSION, NETWORK_FAILURE }

    private companion object {
        const val REFRESH_IDENTITY = "session-refresh"
    }

    private val refreshFlight = SessionFlight<RefreshResult>()

    /**
     * Single-flight refresh: concurrent 401s share one in-flight refresh, so N
     * parallel 401s issue exactly ONE refresh POST. Returns the outcome so the
     * caller can distinguish a genuinely dead session (dialog) from a network
     * blip (no dialog). The work runs in the repository-owned [scope] so a
     * caller (a screen) leaving does not cancel it; the shared outcome is
     * published from inside that job to every joiner.
     */
    suspend fun tryRefresh(): RefreshResult {
        val claim = refreshFlight.claim(REFRESH_IDENTITY)
        if (!claim.isOwner) return refreshFlight.join(claim)
        return scope.async {
            try {
                performRefresh().also { refreshFlight.release(claim, it) }
            } catch (e: Throwable) {
                refreshFlight.fail(claim, e)
                throw e
            }
        }.await()
    }

    private suspend fun performRefresh(): RefreshResult {
        return try {
            val newJwt = refreshToken()
            Backend.authToken = newJwt
            val siap = tokenStore?.let { runCatching { it.siapCookie.first() }.getOrNull() }
            val kulon = tokenStore?.let { runCatching { it.kulonCookie.first() }.getOrNull() }
            tokenStore?.save(newJwt, siap, kulon)
            RefreshResult.SUCCESS
        } catch (e: ApiHttpException) {
            // HANYA 401 = bukti sesi mati (SESSION_DEAD / INVALID_TOKEN dari
            // /api/auth/refresh). 429/5xx dari endpoint refresh adalah
            // gangguan server — memperlakukannya sebagai dead session
            // memunculkan popup login ulang palsu (fix relogin-loop).
            if (e.status == 401) RefreshResult.DEAD_SESSION
            else RefreshResult.NETWORK_FAILURE
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            RefreshResult.NETWORK_FAILURE // do NOT fire the dialog (wasmJs has no IOException)
        }
    }

    /**
     * Maps every backend call into [ApiResult] (see [ErrorType]). On 401:
     * - If !retryable (POST path like markKehadiran): no refresh attempted;
     *   serviceStale 401 → upstream data gagal (error per-layar), sesi backend
     *   mati hanya bila endpoint tidak menyentuh upstream (dialog).
     * - If retryable: single-flight refresh, then retries block() once.
     *
     * [serviceStale] marks calls whose data is scraped from Kulon/SIAP with the
     * user's stored cookies: their 401 means the UPSTREAM session died while
     * the JWT may still be valid, mapped to [ErrorType.STALE_SESSION]. A backend
     * envelope carrying a [SERVICE_STALE_CODES] code is treated the same way.
     *
     * DIALOG POLICY (fix relogin-loop): popup "Sesi Berakhir" HANYA muncul saat
     * sesi backend benar-benar mati — refresh gagal 401 (DEAD_SESSION) atau 401
     * pada endpoint yang tidak menyentuh upstream setelah refresh sukses. Retry
     * 401 dengan JWT segar pada endpoint serviceStale selalu berarti upstream
     * stale; memaksa logout di situ menciptakan loop login ulang padahal hanya
     * cookie SIAP/Kulon yang kadaluwarsa (dan re-login pun belum tentu
     * memperbaikinya bila kegagalannya sementara).
     */
    suspend fun <T> safe(
        retryable: Boolean = true,
        serviceStale: Boolean = false,
        block: suspend () -> T,
    ): ApiResult<T> {
        return try {
            ApiResult.Success(block())
        } catch (e: ApiHttpException) {
            val stale = serviceStale || isServiceStaleCode(e.code)
            val staleType = if (stale) ErrorType.STALE_SESSION else ErrorType.UNAUTHORIZED
            if (e.status == 401) {
                if (!retryable) {
                    if (!stale) onSessionExpired()
                    return ApiResult.Error(e.status, e.message, staleType)
                }
                when (tryRefresh()) {
                    RefreshResult.SUCCESS -> {
                        try {
                            ApiResult.Success(block())
                        } catch (e2: ApiHttpException) {
                            val t = typeForHttp(e2.status)
                            // JWT segar PASTI lolos JwtAuthGuard → 401 pada
                            // retry = upstream stale (serviceStale). Endpoint
                            // non-upstream yang masih 401 = sesi bermasalah.
                            val staleRetry = serviceStale || isServiceStaleCode(e2.code)
                            if (t == ErrorType.UNAUTHORIZED && !staleRetry) onSessionExpired()
                            ApiResult.Error(
                                e2.status,
                                e2.message,
                                if (t == ErrorType.UNAUTHORIZED) {
                                    if (staleRetry) ErrorType.STALE_SESSION else ErrorType.UNAUTHORIZED
                                } else {
                                    t
                                },
                            )
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
                val stale = serviceStale || isServiceStaleCode(e.code)
                if (t == ErrorType.UNAUTHORIZED && !stale) onSessionExpired()
                ApiResult.Error(
                    e.status,
                    e.message,
                    if (t == ErrorType.UNAUTHORIZED) {
                        if (stale) ErrorType.STALE_SESSION else ErrorType.UNAUTHORIZED
                    } else {
                        t
                    },
                )
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
