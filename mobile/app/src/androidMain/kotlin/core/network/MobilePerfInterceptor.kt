package ac.undip.sso.core.network

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Debug-only, low-cardinality request telemetry for the mobile Dashboard.
 *
 * It deliberately records only the SIAP Dashboard paths and the task-list
 * Kulon paths, status,
 * duration, and response length. It never records headers, query parameters,
 * cookies, tokens, request/response bodies, or user identifiers.
 */
internal class MobilePerfInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val path = metricPath(request.url.encodedPath) ?: return chain.proceed(request)

        val startedAt = System.nanoTime()
        return try {
            val response = chain.proceed(request)
            emit(
                path = path,
                status = response.code,
                outcome = if (response.isSuccessful) "ok" else "error",
                durationMs = elapsedMs(startedAt),
                responseBytes = response.body.contentLength(),
            )
            response
        } catch (error: Exception) {
            emit(
                path = path,
                status = null,
                outcome = "error",
                durationMs = elapsedMs(startedAt),
                responseBytes = null,
            )
            throw error
        }
    }

    private fun emit(
        path: String,
        status: Int?,
        outcome: String,
        durationMs: Long,
        responseBytes: Long?,
    ) {
        val statusJson = status?.toString() ?: "null"
        val bytesJson = responseBytes?.takeIf { it >= 0 }?.toString() ?: "null"
        val event =
            "{\"v\":1,\"event\":\"mobile.http\",\"ts\":${System.currentTimeMillis()}," +
                "\"method\":\"GET\",\"path\":\"$path\",\"outcome\":\"$outcome\"," +
                "\"status\":$statusJson,\"durationMs\":$durationMs,\"responseBytes\":$bytesJson}"
        Log.i(MOBILE_PERF_TAG, event)
    }

    private fun elapsedMs(startedAt: Long): Long =
        ((System.nanoTime() - startedAt) / 1_000_000L).coerceAtLeast(0L)

    private companion object {
        const val MOBILE_PERF_TAG = "YODIPS_MOBILE_PERF"
        val SIAP_PATHS =
            setOf(
                "/api/siap/profile",
                "/api/siap/irs",
                "/api/siap/khs",
                "/api/siap/jadwal",
            )

        fun metricPath(path: String): String? =
            when {
                path in SIAP_PATHS -> path
                path == "/api/kulon/courses" -> path
                path == "/api/kulon/assignments/all" -> path
                path.startsWith("/api/kulon/assignments/") && path.endsWith("/detail") ->
                    "/api/kulon/assignments/:id/detail"
                else -> null
            }
    }
}
